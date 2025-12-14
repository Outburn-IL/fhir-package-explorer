/* eslint-disable @typescript-eslint/no-explicit-any */
import { FhirPackageInstaller } from 'fhir-package-installer';
import type { FhirPackageIdentifier } from '@outburn/types';
import { FileIndexEntryWithPkg, LookupFilter } from './types';
import fs from 'fs-extra';

/**
 * Sorts an array of FhirPackageIdentifier objects by their id and version.
 * @param arr - The array of FhirPackageIdentifier objects to sort.
 * @returns 
 */
export const sortPackages = (arr: FhirPackageIdentifier[]): FhirPackageIdentifier[] => {
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
 * When multiple matches are found, this function tries to resolve the duplicates using a prioritized strategy.
 * 
 * Resolution strategies (in order of priority):
 * 1. Package filter match - exact package match if specified in filter
 * 2. Implicit-over-core bias - prefer implicit packages (terminology, extensions) over core packages
 * 3. Resource type bias within implicit packages - terminology resources prefer terminology package, others prefer extensions
 * 4. Implicit package version bias - higher package version wins (e.g.,terminology.rX 7.1.0 > 7.0.0) 
 * 5. FHIR version bias - higher FHIR version wins when implicit package versions are equal (terminology.r5@7.0.0 > terminology.r4@7.0.0)
 * 6. Semver resolution - latest version of the same package
 * 
 * @param matches 
 * @param filter 
 * @param fpi 
 * @returns 
 */
export const tryResolveDuplicates = async (matches: FileIndexEntryWithPkg[], filter: LookupFilter, fpi: FhirPackageInstaller): Promise<FileIndexEntryWithPkg[]> => {
  // 1. Package filter match: if one of the matches is from the same package as in the filter, return that one
  if (filter.package) {
    const pkgIdentifier = await fpi.toPackageObject(filter.package);
    const filteredMatches = matches.filter(m => m.__packageId === pkgIdentifier.id && m.__packageVersion === pkgIdentifier.version);
    if (filteredMatches.length === 1) return filteredMatches;
  }

  // Helper functions for package classification
  const isCorePackage = (packageId: string): boolean => /^hl7\.fhir\.r\d+\.core$/.test(packageId);
  const isTerminologyPackage = (packageId: string): boolean => /^hl7\.terminology\.r\d+$/.test(packageId);
  const isExtensionsPackage = (packageId: string): boolean => /^hl7\.fhir\.uv\.extensions\.r\d+$/.test(packageId);
  const isImplicitPackage = (packageId: string): boolean => isTerminologyPackage(packageId) || isExtensionsPackage(packageId);
  const isTerminologyResource = (resourceType: string): boolean => ['ValueSet', 'ConceptMap', 'CodeSystem'].includes(resourceType);

  /**
   * Extracts the FHIR version (e.g. 4 from r4) from an implicit package ID.
   * This is only safe to call on packages validated by isImplicitPackage.
   */
  const extractFhirVersionFromImplicitPackageId = (packageId: string): number => {
    const match = packageId.match(/\.r(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  };

  const compareSemver = (a: string | undefined, b: string | undefined): number => {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;

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
    return 0;
  };

  // 2. Implicit-over-core bias: implicit packages ALWAYS win over core packages
  const coreMatches = matches.filter(m => isCorePackage(m.__packageId));
  const implicitMatches = matches.filter(m => isImplicitPackage(m.__packageId));
  
  if (implicitMatches.length > 0 && coreMatches.length > 0) {
    // Implicit packages always win over core packages (they're more up-to-date)
    matches = implicitMatches;
  } else if (coreMatches.length === 1 && implicitMatches.length === 0) {
    // Traditional core-bias: if exactly one match is from core and no implicit packages, prefer core
    return coreMatches;
  } else if (implicitMatches.length > 0 && coreMatches.length === 0) {
    // We have implicit matches but no core matches - prefer implicit packages
    matches = implicitMatches;
  }

  // 3. Resource type bias within implicit packages
  if (matches.length > 1 && matches.every(m => isImplicitPackage(m.__packageId))) {
    const terminologyMatches = matches.filter(m => isTerminologyPackage(m.__packageId));
    const extensionsMatches = matches.filter(m => isExtensionsPackage(m.__packageId));
    
    if (terminologyMatches.length > 0 && extensionsMatches.length > 0) {
      // We have matches in both implicit packages, use resource type to decide
      if (filter.resourceType && isTerminologyResource(filter.resourceType)) {
        matches = terminologyMatches;
      } else {
        matches = extensionsMatches;
      }
    }
  }

  // 4 & 5. Package version and FHIR version bias for implicit packages
  if (matches.length > 1 && matches.every(m => isImplicitPackage(m.__packageId))) {
    // Sort by package version (descending), then by FHIR version (descending)
    matches.sort((a, b) => {
      // First compare package versions
      const versionComparison = compareSemver(b.__packageVersion, a.__packageVersion);
      if (versionComparison !== 0) return versionComparison;
      
      // If package versions are equal, compare FHIR versions
      return extractFhirVersionFromImplicitPackageId(b.__packageId) - extractFhirVersionFromImplicitPackageId(a.__packageId);
    });
    
    // Return the best match (highest package version, then highest FHIR version)
    return [matches[0]];
  }

  // 6. Semver resolution: try to resolve by semver where matches are from different versions of the same package
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
  const { __packageId, __packageVersion, resourceType, url, id, name, version, derivation } = entry;
  const keys: string[] = [];

  if (__packageId && __packageVersion && resourceType && id && derivation) keys.push(`pkg:${__packageId}#${__packageVersion}|resourceType:${resourceType}|id:${id}|derivation:${derivation}`);
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