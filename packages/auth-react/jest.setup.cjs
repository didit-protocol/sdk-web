// React 19's server renderer expects these Node globals, which jsdom lacks.
const { TextDecoder, TextEncoder } = require("node:util");

global.TextEncoder ??= TextEncoder;
global.TextDecoder ??= TextDecoder;
