const { NxAppWebpackPlugin } = require("@nx/webpack/app-plugin");
const { join } = require("path");
const { ExternalsPlugin } = require("webpack");

module.exports = {
  output: {
    path: join(__dirname, "dist"),
    clean: true,
    ...(process.env.NODE_ENV !== "production" && {
      devtoolModuleFilenameTemplate: "[absolute-resource-path]",
    }),
  },
  plugins: [
    // pdfkit loads its standard fonts through a wildcard package import ("#standard-fonts/*") that webpack cannot
    // resolve; it is loaded from node_modules at runtime instead of being bundled (it is an API dependency).
    new ExternalsPlugin("commonjs", ["pdfkit"]),
    new NxAppWebpackPlugin({
      target: "node",
      compiler: "tsc",
      main: "./src/main.ts",
      tsConfig: "./tsconfig.app.json",
      assets: ["./src/assets"],
      optimization: false,
      outputHashing: "none",
      generatePackageJson: false,
      sourceMap: true,
    }),
  ],
};
