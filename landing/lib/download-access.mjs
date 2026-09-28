// Compatibility import for callers of the old download handler. Password and
// Discord grants no longer authorize downloads; current membership is required.
export { createMemberDownloadHandler as createDownloadHandler, DOWNLOADS } from './membership.mjs';
