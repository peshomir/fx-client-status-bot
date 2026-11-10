// Worker-compatible stand-in for `uglify-js`.
//
// uglify-js' Node entry point (tools/node.js) loads its own source at runtime
// with fs.readFileSync + new Function, and lib/ast.js builds AST constructors
// with new Function at module load. Cloudflare Workers have no filesystem and
// forbid dynamic code evaluation, so the real package cannot run there.
//
// FXclient/modUtils.js only needs parse + reprint (compress:false, mangle:false)
// and preservation of `/*...*/` comments, which terser supports. This shim
// exposes the same `minify(code, options)` surface that modUtils.js calls.
import { minify_sync } from "terser"

export function minify(code, options = {}) {
  const terserOptions = {
    compress: options.compress ?? false,
    mangle: options.mangle ?? false,
    format: {},
  }
  if (options.output && options.output.comments !== undefined) {
    terserOptions.format.comments = options.output.comments
  }

  try {
    const result = minify_sync(code, terserOptions)
    return { code: result.code, map: result.map }
  } catch (error) {
    return { error }
  }
}

export default { minify }
