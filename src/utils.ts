/* eslint-disable @typescript-eslint/no-explicit-any */
import { PackageIdentifier } from 'fhir-package-installer';
import { FileIndexEntryWithPkg, LookupFilter } from './types';
import fs from 'fs-extra';

/**
 * Sorts an array of PackageIdentifier objects by their id and version.
 * @param arr - The array of PackageIdentifier objects to sort.
 * @returns 
 */
export const sortPackages = (arr: PackageIdentifier[]): PackageIdentifier[] => {
  return arr.slice().sort((a, b) => {
    const aKey = `${a.id}@${a.version}`;
    const bKey = `${b.id}@${b.version}`;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
};

/**
 * Normalizes the filter by splitting the version from the URL, id or name - if piped (e.g. `bp|4.0.1`).
 * If none of these keys are piped, the filter is returned as is.
 * @param filter - The filter to normalize.
 * @return - The normalized filter.
 */
export const normalizePipedFilter = (filter: LookupFilter): LookupFilter => {
  const newFilter = { ...filter };
  const pipedKeys: (keyof LookupFilter)[] = ['url', 'name', 'id'];
  for (const key of pipedKeys) {
    const val = filter[key];
    if (typeof val === 'string' && val.includes('|')) {
      const [left, right] = val.split('|');
      newFilter[key] = left;
      newFilter.version = right;
      break;
    }
  }
  return newFilter;
};

/**
 * Checks if the entry matches the filter by comparing each key-value pair.
 * If the key is 'package', it is ignored, since package filtering is transitive and handled separately.
 * @param entry - The entry to check.
 * @param filter - The filter to check against.
 * @returns - True if the entry matches the filter (ignoring `package`), false otherwise.
 */
export const matchesFilter = (entry: FileIndexEntryWithPkg, filter: LookupFilter): boolean => {
  for (const [key, value] of Object.entries(filter)) {
    if (key === 'package') continue;
    if ((entry as any)[key] !== value) return false;
  }
  return true;
};

/**
 * Default prethrow function does nothing since the regular throw prints to console.log, which is the default logger
 */
export const prethrow = (msg: Error | any): Error => {
  if (msg instanceof Error) {
    return msg;
  }
  const error = new Error(msg);
  return error;
};

/**
 * When multiple matches are found, this function tries to resolve the duplicates by checking if the results come from different versions of the same package.
 * If so, it returns the match from the latest version of the package. Otherwise, it returns an empty array.
 * @param matches 
 * @returns 
 */
export const tryResolveSemver = (matches: FileIndexEntryWithPkg[]): FileIndexEntryWithPkg[] => {
  const groupedByPkg = new Map<string, string[]>();
  for (const entry of matches) {
    const pkg = entry.__packageId;
    const v = entry.version;
    if (!v || !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(v)) return [];
    if (!groupedByPkg.has(pkg)) groupedByPkg.set(pkg, []);
    groupedByPkg.get(pkg)!.push(v);
  }

  if (groupedByPkg.size !== 1) return [];
  const [pkgId, versions] = Array.from(groupedByPkg.entries())[0];

  function compareSemver(a: string, b: string): number {
    const parse = (v: string) => {
      const [core] = v.split('-');
      const [major, minor, patch] = core.split('.').map(Number);
      return { major, minor, patch };
    };

    const aParts = parse(a);
    const bParts = parse(b);

    if (aParts.major !== bParts.major) return aParts.major - bParts.major;
    if (aParts.minor !== bParts.minor) return aParts.minor - bParts.minor;
    if (aParts.patch !== bParts.patch) return aParts.patch - bParts.patch;

    // Numeric parts are equal
    return 0;
  }

  const latest = versions.slice().sort(compareSemver).pop();
  return matches.filter(m => m.__packageId === pkgId && m.version === latest);
};

export const loadJson = async (filePath: string): Promise<any> => {
  return await fs.readJson(filePath);
};

/**
 * Takes an entry and returns an array of key combinations used to index the entry for fast lookups.
 * @param entry - The entry to get the keys for.
 * @returns - An array of keys for the entry.
 */
export const getAllFastIndexKeys = (entry: FileIndexEntryWithPkg): string[] => {
  const { __packageId, __packageVersion, resourceType, url, id, name, version } = entry;
  const keys: string[] = [];

  if (__packageId && __packageVersion && resourceType && url) keys.push(`pkg:${__packageId}#${__packageVersion}|resourceType:${resourceType}|url:${url}`);
  if (resourceType && url && version) keys.push(`resourceType:${resourceType}|url:${url}|version:${version}`);
  if (resourceType && url) keys.push(`resourceType:${resourceType}|url:${url}`);
  if (url && version) keys.push(`url:${url}|version:${version}`);
  if (url) keys.push(`url:${url}`);
  if (resourceType && name && version) keys.push(`resourceType:${resourceType}|name:${name}|version:${version}`);
  if (resourceType && id && version) keys.push(`resourceType:${resourceType}|id:${id}|version:${version}`);
  if (resourceType && name) keys.push(`resourceType:${resourceType}|name:${name}`);
  if (resourceType && id) keys.push(`resourceType:${resourceType}|id:${id}`);

  return keys;
};