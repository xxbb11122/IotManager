import { createHash } from 'node:crypto';

/** Frozen Glass.5 v2 source from 0c0ed0393f880d6483ce72632bdaa8980a3a4afe. */
export function patchLegacyCache(source, importSpecifier = './cache-schema.js') {
  const normalized = source.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').trimEnd() + '\n';
  const hash = createHash('sha256').update(normalized).digest('hex');
  const declaration = "import { openDB } from 'idb';";
  if (hash !== '0c6d812f9db7a770a5b4c8c2cbc3168d9a93a0dc6fce14d6ab9171df4954529e' ||
      source.split(declaration).length !== 2 || !/openDB\(this\.databaseName, 2, \{/.test(source)) {
    throw new Error('Baseline does not contain the reviewed v2 cache implementation');
  }
  return source.replace(declaration,
    `import { openCompatibleCache as openDB } from ${JSON.stringify(importSpecifier)};`);
}
