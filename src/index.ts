/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  FhirPackageInstaller,
  PackageIdentifier,
  FileInPackageIndex,
  ILogger
} from 'fhir-package-installer';
import path from 'path';

import { FileIndexEntryWithPkg, ExplorerConfig, LookupFilter } from './types';
import { getAllFastIndexKeys, loadJson, matchesFilter, normalizePipedFilter, prethrow, sortPackages, tryResolveDuplicates } from './utils';

export class FhirPackageExplorer {
  private fpi: FhirPackageInstaller;
  private cachePath: string;
  private logger: ILogger;
  private indexCache = new Map<string, FileIndexEntryWithPkg[]>();
  private contentCache = new Map<string, any>();
  private fastIndex = new Map<string, FileIndexEntryWithPkg[]>();
  private contextPackages: PackageIdentifier[] = [];
  private normalizedRootPackages: PackageIdentifier[] = [];
  private skipExamples: boolean = false;
  private prethrow: (msg: Error | any) => Error = prethrow;

  static async create(config: ExplorerConfig): Promise<FhirPackageExplorer> {
    const instance = new FhirPackageExplorer(config);
    try {
      await instance._loadContext(config.context);
      return instance;
    } catch (error) {
      instance.logger.error('Error loading context packages');
      throw instance.prethrow(error);
    }
  }

  private constructor(config: ExplorerConfig) {
    const { logger, registryUrl, registryToken, cachePath, skipExamples } = config || {} as ExplorerConfig;
    this.fpi = new FhirPackageInstaller({ logger, registryUrl, registryToken, cachePath, skipExamples });
    this.logger = this.fpi.getLogger();
    if (this.logger) this.prethrow = (msg: Error | any) => {
      if (!(msg instanceof Error)) {
        msg = new Error(msg);
      }
      this.logger.error(msg.message);
      this.logger.error(JSON.stringify(msg, null, 2));
      return msg;
    };
    this.cachePath = this.fpi.getCachePath();
    if (skipExamples) this.skipExamples = skipExamples;
  }

  public getCachePath(): string {
    return this.cachePath;
  }

  public getLogger(): ILogger {
    return this.logger;
  }

  public getContextPackages(): PackageIdentifier[] {
    return this.contextPackages;
  }

  /**
   * Get the list of direct package dependencies for a given package.
   * @param pkg - The package to expand. Can be a string or a PackageIdentifier object.
   * @returns - A promise that resolves to an array of PackageIdentifier objects.
   */
  public async getDirectDependencies(pkg: string | PackageIdentifier): Promise<PackageIdentifier[]> {
    try {
      const pkgObj = typeof pkg === 'string' ? await this.fpi.toPackageObject(pkg) : pkg;
      const dependencies = await this.fpi.getDependencies(pkgObj);
      return Object.entries(dependencies).map(([id, version]) => ({ id, version }));
    } catch (error) {
      this.logger.error(`Error reading package dependencies for ${String(pkg)}`);
      throw this.prethrow(error);
    }
  }
  
  /**
   * Expands the package into a list of packages including all transitive dependencies.
   * @param pkg - The package to expand. Can be a string or a PackageIdentifier object.
   * @returns - A promise that resolves to an array of PackageIdentifier objects representing the expanded packages.
   */
  public async expandPackageDependencies(pkg: string | PackageIdentifier): Promise<PackageIdentifier[]> {
    try {
      const pkgObj = typeof pkg === 'string' ? await this.fpi.toPackageObject(pkg) : pkg;
      const expanded: string[] = Array.from(await this._collectDependencies(pkgObj));
      return sortPackages(await Promise.all(expanded.map(async (p) => await this.fpi.toPackageObject(p))));
    } catch (error) {
      this.logger.error(`Error expanding package dependencies for ${String(pkg)}`);
      throw this.prethrow(error);
    }
  }

  public async lookup(filter: LookupFilter = {}): Promise<any[]> {
    try {
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
    } catch (error) {
      this.logger.error(`Error looking up resources with filter: ${JSON.stringify(filter)}`);
      throw this.prethrow(error);
    }
  }

  public async lookupMeta(filter: LookupFilter = {}): Promise<FileIndexEntryWithPkg[]> {
    try {
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
          index = rawIndex.map((file: FileInPackageIndex) => ({
            ...file,
            __packageId: pkg.id,
            __packageVersion: pkg.version
          }));
          this.indexCache.set(pkgKey, index);
          this._buildFastIndex(index);
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
    } catch (error) {
      this.logger.error(`Error looking up metadata with filter: ${JSON.stringify(filter)}`);
      throw this.prethrow(error);
    }
  }

  public async resolve(filter: LookupFilter = {}): Promise<any> {
    try {
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
    } catch (error) {
      throw this.prethrow(`Error resolving resource with filter: ${JSON.stringify(filter)}. Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async resolveMeta(filter: LookupFilter = {}): Promise<FileIndexEntryWithPkg> {
    try {
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
    } catch (error) {
      throw this.prethrow(`Error resolving metadata with filter: ${JSON.stringify(filter)}. Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the manifest (package.json) for a given FHIR package.
   * Returns the parsed manifest object for the specified package, or throws if not found.
   *
   * @param pkg - The package to fetch the manifest for (string or PackageIdentifier).
   * @returns A promise that resolves to the manifest (package.json) object for the package.
   */
  public async getPackageManifest(pkg: string | PackageIdentifier): Promise<any> {
    try {
      const meta = await this.fpi.getManifest(pkg);
      if (!meta) throw new Error(`Failed to fetch manifest (package.json) for package: ${String(pkg)}`);
      return meta;
    } catch (error) {
      throw this.prethrow(error);
    }
  }

  private async _loadContext(context: Array<string | PackageIdentifier>) {
    // Resolve provided context entries into root packages (dedup first)
    const rootMap = new Map<string, PackageIdentifier>();
    for (const entry of context) {
      const pkg = await this.fpi.toPackageObject(entry);
      rootMap.set(`${pkg.id}#${pkg.version}`, pkg);
    }
    const initialRoots = Array.from(rootMap.values());

    // For each root, compute its full transitive dependency closure (including itself)
    const rootClosures = new Map<string, Set<string>>();
    const keyToPkg = new Map<string, PackageIdentifier>();
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
    const finalContextMap = new Map<string, PackageIdentifier>();
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

  private async _collectDependencies(pkg: PackageIdentifier): Promise<Set<string>> {
    const visited = new Set<string>();
    const visit = async (p: PackageIdentifier) => {
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
        if (!this.fastIndex.has(key)) this.fastIndex.set(key, []);
        this.fastIndex.get(key)!.push(file);
      }
    }
  }

  /**
   * Get the normalized minimal set of root packages from the context.
   * Returns only the root packages that are not dependencies of other root packages,
   * effectively removing redundant entries from the originally provided context.
   *
   * @returns An array of PackageIdentifier objects representing the minimal root packages.
   */
  public getNormalizedRootPackages(): PackageIdentifier[] {
    return this.normalizedRootPackages;
  }
}

export type {
  PackageIdentifier,
  FileInPackageIndex,
  ILogger,
  FileIndexEntryWithPkg,
  ExplorerConfig,
  LookupFilter 
};
