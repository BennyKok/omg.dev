import { expect, test } from "bun:test";
import { join } from "node:path";

const cwd = join(import.meta.dir, "..");

// Expo Router still uses query-string 7's CommonJS entry. The security fix
// for decode-uri-component is ESM, so exercise that boundary in both runtimes.
for (const runtime of ["node", "bun"]) {
  test(`Expo Router query parsing works with the patched decoder under ${runtime}`, () => {
    const result = Bun.spawnSync([runtime, "-e", `
      const assert = require('node:assert/strict');
      const query = require('query-string');
      assert.deepEqual({ ...query.parse('name=Benny%20Kok&tag=a&tag=b&empty=') }, {
        name: 'Benny Kok', tag: ['a', 'b'], empty: '',
      });
      assert.deepEqual({ ...query.parseUrl('omg://session?id=a%2Fb&label=%C3%A5').query }, {
        id: 'a/b', label: 'å',
      });
      // Malformed runs must remain tolerant, and decoding must happen once.
      assert.equal(query.parse('value=%25C3%25A5%FF').value, '%C3%A5%FF');
      const malformed = '%41%FF'.repeat(10000);
      assert.equal(query.parse('value=' + malformed).value, 'A%FF'.repeat(10000));
    `], { cwd, stdout: "pipe", stderr: "pipe" });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });
}

test("Expo code signing can round-trip certificates and verify a signature with patched forge", () => {
  const result = Bun.spawnSync(["node", "-e", `
    const assert = require('node:assert/strict');
    const signing = require('@expo/code-signing-certificates');
    const keys = signing.generateKeyPair();
    const certificate = signing.generateSelfSignedCodeSigningCertificate({
      keyPair: keys,
      validityNotBefore: new Date(Date.now() - 60000),
      validityNotAfter: new Date(Date.now() + 60000),
      commonName: 'dependency compatibility check',
    });
    const decoded = signing.convertCertificatePEMToCertificate(
      signing.convertCertificateToCertificatePEM(certificate),
    );
    signing.validateSelfSignedCertificate(decoded, keys);
    const signature = signing.signBufferRSASHA256AndVerify(
      keys.privateKey, decoded, Buffer.from('test manifest'),
    );
    assert.ok(Buffer.from(signature, 'base64').length > 0);
  `], { cwd, stdout: "pipe", stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});

test("the native noVNC viewer disables the WebCodecs probe", () => {
  const result = Bun.spawnSync(["node", "-e", `
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const { pathToFileURL } = require('node:url');
    const element = () => ({
      style: {}, offsetWidth: 0,
      appendChild(child) { child.parentNode = this; }, removeChild() {},
    });
    global.document = { documentElement: {}, body: element(), createElement: element };
    let probes = 0;
    global.VideoDecoder = { isConfigSupported() { probes++; return { supported: false }; } };
    global.window = {
      console, VideoDecoder, addEventListener() {}, removeEventListener() {},
    };
    const browser = path.join(path.dirname(require.resolve('@novnc/novnc')), 'util/browser.js');
    import(pathToFileURL(browser).href).then(module => {
      assert.equal(module.supportsWebCodecsH264Decode, false);
      assert.equal(probes, 0);
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd, stdout: "pipe", stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
