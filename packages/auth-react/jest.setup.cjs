// React's browser server renderer (used under jsdom) needs these Node globals, which jsdom lacks.
const { MessageChannel } = require("node:worker_threads");
const { TextDecoder, TextEncoder } = require("node:util");

global.MessageChannel ??= MessageChannel;
global.TextEncoder ??= TextEncoder;
global.TextDecoder ??= TextDecoder;
