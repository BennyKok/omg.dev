import ExpoModulesCore
import UIKit
import WebKit

public class OmgBrowserLoginModule: Module {
  private var login: LoginController?

  public func definition() -> ModuleDefinition {
    Name("OmgBrowserLogin")
    AsyncFunction("open") { (address: String, computer: String, promise: Promise) in
      guard self.login == nil else {
        promise.reject("LOGIN_BUSY", "A website login is already open")
        return
      }
      guard let url = URL(string: address), url.scheme == "https", url.host != nil,
            url.user == nil, url.password == nil else {
        promise.reject("LOGIN_URL", "A secure website URL is required")
        return
      }
      let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        .first { $0.activationState == .foregroundActive }
      var presenter = scene?.windows.first { $0.isKeyWindow }?.rootViewController
      while let next = presenter?.presentedViewController { presenter = next }
      guard let presenter else {
        promise.reject("LOGIN_VIEW", "Open the app before starting a login")
        return
      }
      let controller = LoginController(url: url, computer: computer) { result in
        self.login = nil
        promise.resolve(result)
      }
      self.login = controller
      let nav = UINavigationController(rootViewController: controller)
      nav.modalPresentationStyle = .fullScreen
      presenter.present(nav, animated: true)
    }.runOnQueue(.main)
    AsyncFunction("close") {
      self.login?.cancel()
    }.runOnQueue(.main)
  }
}

private final class LoginController: UIViewController, WKNavigationDelegate, WKUIDelegate {
  private let target: URL
  private let computer: String
  private let finish: ([String: Any]) -> Void
  private var finished = false
  private var web: WKWebView!
  private let address = UILabel()
  private let progress = UIProgressView(progressViewStyle: .default)
  private var progressObservation: NSKeyValueObservation?

  init(url: URL, computer: String, finish: @escaping ([String: Any]) -> Void) {
    self.target = url
    self.computer = computer
    self.finish = finish
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    title = "Website login"
    navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Cancel", style: .plain, target: self, action: #selector(cancel))
    navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Use login", style: .done, target: self, action: #selector(approve))
    address.font = .preferredFont(forTextStyle: .footnote)
    address.textColor = .secondaryLabel
    address.textAlignment = .center
    address.numberOfLines = 2
    address.text = target.host
    address.accessibilityIdentifier = "browser-login-address"
    let config = WKWebViewConfiguration()
    // Every request gets its own jar. Cancelling cannot leave a reusable login.
    config.websiteDataStore = .nonPersistent()
    web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = true
    let stack = UIStackView(arrangedSubviews: [address, progress, web])
    stack.axis = .vertical
    stack.spacing = 6
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      address.heightAnchor.constraint(greaterThanOrEqualToConstant: 32)
    ])
    toolbarItems = [
      UIBarButtonItem(title: "Back", style: .plain, target: self, action: #selector(back)),
      UIBarButtonItem(systemItem: .flexibleSpace),
      UIBarButtonItem(title: "Reload", style: .plain, target: self, action: #selector(reload))
    ]
    navigationController?.setToolbarHidden(false, animated: false)
    progressObservation = web.observe(\.estimatedProgress, options: [.new]) { [weak self] web, _ in
      self?.progress.progress = Float(web.estimatedProgress)
      self?.progress.isHidden = web.estimatedProgress >= 1
    }
    web.load(URLRequest(url: target))
  }

  @objc func cancel() { complete(["cancelled": true]) }
  @objc private func back() { web.goBack() }
  @objc private func reload() { web.reload() }

  private func complete(_ result: [String: Any]) {
    guard !finished else { return }
    finished = true
    web?.stopLoading()
    web?.navigationDelegate = nil
    web?.uiDelegate = nil
    dismiss(animated: true) { self.finish(result) }
  }

  private func showError(_ message: String) {
    let alert = UIAlertController(title: "Login not ready", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    present(alert, animated: true)
  }

  @objc private func approve() {
    guard web.url?.host?.lowercased() == target.host?.lowercased(), web.url?.scheme == "https" else {
      showError("Finish signing in and return to \(target.host ?? "the requested website") first.")
      return
    }
    let alert = UIAlertController(title: "Use this login on your computer?",
      message: "Agents on \(computer) will be able to use your \(target.host ?? "website") account. Only this website's login will be transferred.", preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Not now", style: .cancel))
    alert.addAction(UIAlertAction(title: "Transfer login", style: .default) { [weak self] _ in self?.exportCookies() })
    present(alert, animated: true)
  }

  private func exportCookies() {
    let host = target.host!.lowercased()
    web.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
      guard let self, !self.finished else { return }
      let matching = cookies.filter { cookie in
        let domain = cookie.domain.lowercased()
        let bare = domain.hasPrefix(".") ? String(domain.dropFirst()) : domain
        return (host == bare || (domain.hasPrefix(".") && host.hasSuffix("." + bare))) &&
          (cookie.expiresDate == nil || cookie.expiresDate! > Date())
      }
      guard !matching.isEmpty else {
        self.showError("This website has no login cookies to transfer. Finish signing in, or use the Computer browser.")
        return
      }
      let payload: [[String: Any]] = matching.map { cookie in
        var item: [String: Any] = ["name": cookie.name, "value": cookie.value,
          "domain": cookie.domain, "path": cookie.path, "secure": cookie.isSecure, "httpOnly": cookie.isHTTPOnly]
        if let expires = cookie.expiresDate { item["expires"] = expires.timeIntervalSince1970 }
        if let policy = cookie.sameSitePolicy {
          let value = policy.rawValue.lowercased()
          if ["strict", "lax", "none"].contains(value) { item["sameSite"] = value.capitalized }
        }
        return item
      }
      self.complete(["cancelled": false, "cookies": payload])
    }
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    // No app links, cleartext downgrade, file URLs, or external application launch.
    guard navigationAction.request.url?.scheme == "https" else {
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    address.text = webView.url?.host
  }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    if (error as NSError).code != NSURLErrorCancelled { showError("The website could not load. Try Reload or use the Computer browser.") }
  }
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if navigationAction.request.url?.scheme == "https" { webView.load(navigationAction.request) }
    return nil
  }
}
