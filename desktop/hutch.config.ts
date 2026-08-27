export default {
  electrobun: {
    version: "2.0.1",
  },
  packageManager: "bun",
  scripts: {
    install: ["hutch", "pm", "install", "--frozen-lockfile"],
    dev: ["hutch", "electrobun", "dev", "--watch"],
    build: ["hutch", "electrobun", "build", "--env=stable"],
    test: ["bun", "test"],
  },
};
