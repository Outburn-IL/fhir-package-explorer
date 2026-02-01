/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  FhirPackageInstaller
} from 'fhir-package-installer';
import path from 'path';
import { LRUCache } from 'lru-cache';
import type { FhirPackageIdentifier, Logger, FileInPackageIndex, FileIndexEntryWithPkg } from '@outburn/types';


import { ExplorerConfig, LookupFilter } from './types';

import { getAllFastIndexKeys, loadJson, matchesFilter, normalizePipedFilter, sortPackages, tryResolveDuplicates, resolveFhirVersionToCorePackage } from './utils';

export class FhirPackageExplorer {
  private fpi: FhirPackageInstaller;
  private cachePath: string;
  private logger: Logger;
  private indexCache: LRUCache<string, FileIndexEntryWithPkg[]>;
  private contentCache: LRUCache<string, any>;
  private fastIndex: LRUCache<string, FileIndexEntryWithPkg[]>;
  private contextPackages: FhirPackageIdentifier[] = [];
  private normalizedRootPackages: FhirPackageIdentifier[] = [];
  private skipExamples: boolean = false;

  static async create(config: ExplorerConfig): Promise<FhirPackageExplorer> {
    const instance = new FhirPackageExplorer(config);
    // Determine the effective context - potentially adding a core package if needed
    let effectiveContext = config.context;
      
    // If fhirVersion is specified, check if we need to auto-add a core package
    if (config.fhirVersion) {
      // First, load the initial context to check what's there
      await instance._loadContext(config.context);
        
      // Check if any FHIR core package is in the context
      const hasCorePackage = instance.contextPackages.some(pkg => 
        pkg.id.match(/^hl7\.fhir\.r\d+b?\.core$/)
      );
        
      if (!hasCorePackage) {
        // No core package found - add one based on fhirVersion
        const corePackage = resolveFhirVersionToCorePackage(config.fhirVersion);
          
        instance.logger.warn?.(
          `No FHIR core package found in context. Auto-adding: ${corePackage.id}@${corePackage.version}`
        );
          
        // Reload context with the core package added
        effectiveContext = [...config.context, corePackage];
        await instance._loadContext(effectiveContext);
      }
    } else {
      // Just load the context as-is
      await instance._loadContext(effectiveContext);
    }
      
    return instance;
  }

  private constructor(config: ExplorerConfig) {
    const {
      logger,
      registryUrl,
      registryToken,
      cachePath,
      skipExamples,
      contentCacheSize,
      indexCacheSize,
      fastIndexSize
    } = config || {} as ExplorerConfig;
    this.fpi = new FhirPackageInstaller({ logger, registryUrl, registryToken, cachePath, skipExamples });
    this.logger = logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    };
    this.cachePath = this.fpi.getCachePath();
    if (skipExamples) this.skipExamples = skipExamples;
    this.contentCache = new LRUCache({ max: contentCacheSize ?? 500 });
    this.indexCache = new LRUCache({ max: indexCacheSize ?? 500 });
    this.fastIndex = new LRUCache({ max: fastIndexSize ?? 10000 });
  }

  public getCachePath(): string {
    return this.cachePath;
  }

  public getLogger(): Logger {
    return this.logger;
  }

  public getContextPackages(): FhirPackageIdentifier[] {
    return this.contextPackages;
  }

  /**
   * Get the list of direct package dependencies for a given package.
   * @param pkg - The package to expand. Can be a string or a FhirPackageIdentifier object.
   * @returns - A promise that resolves to an array of FhirPackageIdentifier objects.
   */
  public async getDirectDependencies(pkg: string | FhirPackageIdentifier): Promise<FhirPackageIdentifier[]> {
    const pkgObj = typeof pkg === 'string' ? await this.fpi.toPackageObject(pkg) : pkg;
    const dependencies = await this.fpi.getDependencies(pkgObj);
    return Object.entries(dependencies).map(([id, version]) => ({ id, version }));
  }
  
  /**
   * Expands the package into a list of packages including all transitive dependencies.
   * @param pkg - The package to expand. Can be a string or a FhirPackageIdentifier object.
   * @returns - A promise that resolves to an array of FhirPackageIdentifier objects representing the expanded packages.
   */
  public async expandPackageDependencies(pkg: string | FhirPackageIdentifier): Promise<FhirPackageIdentifier[]> {
    const pkgObj = typeof pkg === 'string' ? await this.fpi.toPackageObject(pkg) : pkg;
    const expanded: string[] = Array.from(await this._collectDependencies(pkgObj));
    return sortPackages(await Promise.all(expanded.map(async (p) => await this.fpi.toPackageObject(p))));
  }

  public async lookup(filter: LookupFilter = {}): Promise<any[]> {
    const meta = await this.lookupMeta(filter);
    const results = await Promise.all(meta.map(async (entry) => {
      const filePath = await this._getFilePath(entry);
      if (this.contentCache.has(filePath)) return this.contentCache.get(filePath);
      const content = await loadJson(filePath);
      const enriched = {
        __packageId: entry.__packageId,
        __packageVersion: entry.__packageVersion,
        __filename: entry.filename,
        ...content
      };
      this.contentCache.set(filePath, enriched);
      return enriched;
    }));
    return results;
  }

  public async lookupMeta(filter: LookupFilter = {}): Promise<FileIndexEntryWithPkg[]> {
    const normalizedFilter = normalizePipedFilter(filter);
    const pkgIdentifiers = this.contextPackages;
  
    let allowedPackages: Set<string> | undefined = undefined;
    if (normalizedFilter.package) {
      const scopedPackage = await this.fpi.toPackageObject(normalizedFilter.package);
      allowedPackages = await this._collectDependencies(scopedPackage);
    }
  
    const resultMap = new Map<string, FileIndexEntryWithPkg>();
  
    for (const pkg of pkgIdentifiers) {
      const pkgKey = `${pkg.id}#${pkg.version}`;
      if (allowedPackages && !allowedPackages.has(pkgKey)) continue;
  
      let index = this.indexCache.get(pkgKey);
      if (!index) {
        await this.fpi.install(pkg);
        const rawPkgIndex = await this.fpi.getPackageIndexFile(pkg);
        const rawIndex = rawPkgIndex.files ?? [];
        const newIndex = rawIndex.map((file: FileInPackageIndex) => ({
          ...file,
          __packageId: pkg.id,
          __packageVersion: pkg.version
        }));
        this.indexCache.set(pkgKey, newIndex);
        this._buildFastIndex(newIndex);
        index = newIndex;
      }
  
      const fastKeys = getAllFastIndexKeys(normalizedFilter as FileIndexEntryWithPkg);
      const fastCandidates = fastKeys.flatMap(k => this.fastIndex.get(k) ?? []);
  
      const candidates = fastCandidates.length > 0 ? fastCandidates : index;
  
      for (const entry of candidates) {
        const entryPkgKey = `${entry.__packageId}#${entry.__packageVersion}`;
        if (allowedPackages && !allowedPackages.has(entryPkgKey)) continue;
        if (!matchesFilter(entry, normalizedFilter)) continue;
        const compositeKey = `${entry.filename}|${entry.__packageId}|${entry.__packageVersion}`;
        if (!resultMap.has(compositeKey)) {
          resultMap.set(compositeKey, entry);
        }
      }
    }
  
    return Array.from(resultMap.values());
  }

  public async resolve(filter: LookupFilter = {}): Promise<any> {
    const matches = await this.lookup(filter);
    if (matches.length === 0) throw new Error(`No matching resource found with filter: ${JSON.stringify(filter)}`);
    if (matches.length > 1) {
      const candidates = await tryResolveDuplicates(matches, filter, this.fpi);
      if (candidates.length !== 1) {
        const matchInfo = matches.map(m => `${m.__packageId}@${m.__packageVersion}`).join(', ');
        throw new Error(`Multiple matching resources found with filter: ${JSON.stringify(filter)}. Found in packages: ${matchInfo}`);
      }
      return candidates[0];
    }
    return matches[0];
  }

  public async resolveMeta(filter: LookupFilter = {}): Promise<FileIndexEntryWithPkg> {
    const matches = await this.lookupMeta(filter);
    if (matches.length === 0) throw new Error(`No matching resource found with filter: ${JSON.stringify(filter)}`);
    if (matches.length > 1) {
      const candidates = await tryResolveDuplicates(matches, filter, this.fpi);
      if (candidates.length !== 1) {
        const matchInfo = matches.map(m => `${m.__packageId}@${m.__packageVersion}`).join(', ');
        throw new Error(`Multiple matching resources found with filter: ${JSON.stringify(filter)}. Found in packages: ${matchInfo}`);
      }
      return candidates[0];
    }
    return matches[0];
  }

  /**
   * Get the manifest (package.json) for a given FHIR package.
   * Returns the parsed manifest object for the specified package, or throws if not found.
   *
   * @param pkg - The package to fetch the manifest for (string or FhirPackageIdentifier).
   * @returns A promise that resolves to the manifest (package.json) object for the package.
   */
  public async getPackageManifest(pkg: string | FhirPackageIdentifier): Promise<any> {
    const meta = await this.fpi.getManifest(pkg);
    if (!meta) throw new Error(`Failed to fetch manifest (package.json) for package: ${String(pkg)}`);
    return meta;
  }

  private async _loadContext(context: Array<string | FhirPackageIdentifier>) {
    // Resolve provided context entries into root packages (dedup first)
    const rootMap = new Map<string, FhirPackageIdentifier>();
    for (const entry of context) {
      const pkg = await this.fpi.toPackageObject(entry);
      rootMap.set(`${pkg.id}#${pkg.version}`, pkg);
    }
    const initialRoots = Array.from(rootMap.values());

    // For each root, compute its full transitive dependency closure (including itself)
    const rootClosures = new Map<string, Set<string>>();
    const keyToPkg = new Map<string, FhirPackageIdentifier>();
    for (const root of initialRoots) {
      await this.fpi.install(root); // ensure root is installed before dependency walk
      const closure = await this._collectDependencies(root); // Set of id#version (includes root)
      rootClosures.set(`${root.id}#${root.version}`, closure);
      // Track all packages encountered for later object reconstruction
      for (const key of closure) {
        const [id, version] = key.split('#');
        keyToPkg.set(key, { id, version });
      }
    }

    // Determine redundant roots: any root that appears in another root's closure
    const redundant = new Set<string>();
    const allRootKeys = Array.from(rootClosures.keys());
    for (const [rootKey, closure] of rootClosures.entries()) {
      for (const otherKey of allRootKeys) {
        if (rootKey === otherKey) continue;
        if (closure.has(otherKey)) {
          // other root is covered by this root; mark redundant
          redundant.add(otherKey);
        }
      }
    }

    // Minimal normalized root packages = roots not marked redundant
    let minimalRoots = initialRoots.filter(r => !redundant.has(`${r.id}#${r.version}`));
    // Handle pathological cycles where all roots ended up redundant (keep deterministic first root)
    if (minimalRoots.length === 0 && initialRoots.length > 0) {
      minimalRoots = [sortPackages(initialRoots)[0]];
    }

    // Build final full context package set = union of closures of minimal roots
    const finalContextMap = new Map<string, FhirPackageIdentifier>();
    for (const mr of minimalRoots) {
      const closure = rootClosures.get(`${mr.id}#${mr.version}`)!;
      for (const key of closure) {
        const pkgObj = keyToPkg.get(key);
        if (pkgObj) finalContextMap.set(key, pkgObj);
      }
    }

    // Install all packages in final context to ensure downstream availability
    for (const pkg of finalContextMap.values()) {
      await this.fpi.install(pkg);
    }

    // Store normalized roots (canonical ordering) and full context packages
    this.normalizedRootPackages = sortPackages(minimalRoots);
    this.contextPackages = sortPackages(Array.from(finalContextMap.values()));
  }

  private async _collectDependencies(pkg: FhirPackageIdentifier): Promise<Set<string>> {
    const visited = new Set<string>();
    const visit = async (p: FhirPackageIdentifier) => {
      const key = `${p.id}#${p.version}`;
      if (visited.has(key)) return;
      visited.add(key);
      const deps = await this.fpi.getDependencies(p);
      for (const [id, version] of Object.entries(deps || {})) {
        if (this.skipExamples && id.includes('examples')) continue;
        await visit({ id, version });
      }
    };
    await visit(pkg);
    return visited;
  }

  private async _getFilePath(entry: FileIndexEntryWithPkg): Promise<string> {
    const dir = await this.fpi.getPackageDirPath({ id: entry.__packageId, version: entry.__packageVersion });
    return path.join(dir, 'package', entry.filename);
  }

  private _buildFastIndex(index: FileIndexEntryWithPkg[]) {
    for (const file of index) {
      for (const key of getAllFastIndexKeys(file)) {
        const entries = this.fastIndex.get(key) ?? [];
        entries.push(file);
        this.fastIndex.set(key, entries);
      }
    }
  }

  /**
   * Get the normalized minimal set of root packages from the context.
   * Returns only the root packages that are not dependencies of other root packages,
   * effectively removing redundant entries from the originally provided context.
   *
   * @returns An array of FhirPackageIdentifier objects representing the minimal root packages.
   */
  public getNormalizedRootPackages(): FhirPackageIdentifier[] {
    return this.normalizedRootPackages;
  }
}

export type {
  FileInPackageIndex,
  FileIndexEntryWithPkg,
  ExplorerConfig,
  LookupFilter 
};
