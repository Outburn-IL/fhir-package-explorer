/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  FhirPackageInstaller,
  PackageIdentifier,
  FileInPackageIndex,
  ILogger
} from 'fhir-package-installer';
import path from 'path';

import { FileIndexEntryWithPkg, ExplorerConfig, LookupFilter } from './types';
import { getAllFastIndexKeys, loadJson, matchesFilter, normalizePipedFilter, prethrow, sortPackages, tryResolveSemver } from './utils';

export class FhirPackageExplorer {
  private fpi: FhirPackageInstaller;
  private cachePath: string;
  private logger: ILogger;
  private indexCache = new Map<string, FileIndexEntryWithPkg[]>();
  private contentCache = new Map<string, any>();
  private fastIndex = new Map<string, FileIndexEntryWithPkg[]>();
  private contextPackages: PackageIdentifier[] = [];
  private skipExamples: boolean = false;
  private prethrow: (msg: Error | any) => Error = prethrow;

  static async create(config: ExplorerConfig): Promise<FhirPackageExplorer> {
    const instance = new FhirPackageExplorer(config);
    try {
      await instance.loadContext(config.context);
      return instance;
    } catch (error) {
      instance.logger.error('Error loading context packages');
      throw instance.prethrow(error);
    }
  }

  private constructor(config: ExplorerConfig) {
    const { logger, registryUrl, cachePath, skipExamples } = config || {} as ExplorerConfig;
    this.fpi = new FhirPackageInstaller({ logger, registryUrl, cachePath, skipExamples });
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
   * Expands the package into a list of packages including all transitive dependencies.
   * @param pkg - The package to expand. Can be a string or a PackageIdentifier object.
   * @returns - A promise that resolves to an array of PackageIdentifier objects representing the expanded packages.
   */
  public async expandPackageDependencies(pkg: string | PackageIdentifier): Promise<PackageIdentifier[]> {
    try {
      const pkgObj = typeof pkg === 'string' ? await this.fpi.toPackageObject(pkg) : pkg;
      const expanded: string[] = Array.from(await this.collectDependencies(pkgObj));
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
        const filePath = await this.getFilePath(entry);
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
        allowedPackages = await this.collectDependencies(scopedPackage);
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
          this.buildFastIndex(index);
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
      if (matches.length === 0) throw this.prethrow(new Error('No matching resource found'));
      if (matches.length > 1) {
        const candidates = tryResolveSemver(matches);
        if (candidates.length !== 1) throw this.prethrow(new Error('Multiple matching resources found'));
        return candidates[0];
      }
      return matches[0];
    } catch (error) {
      this.logger.error(`Error resolving resource with filter: ${JSON.stringify(filter)}`);
      throw this.prethrow(error);
    }
  }

  public async resolveMeta(filter: LookupFilter = {}): Promise<FileIndexEntryWithPkg> {
    try {
      const matches = await this.lookupMeta(filter);
      if (matches.length === 0) throw this.prethrow(new Error('No matching resource found'));
      if (matches.length > 1) {
        const candidates = tryResolveSemver(matches);
        if (candidates.length !== 1) throw this.prethrow(new Error('Multiple matching resources found'));
        return candidates[0];
      }
      return matches[0];
    } catch (error) {
      this.logger.error(`Error resolving metadata with filter: ${JSON.stringify(filter)}`);
      throw this.prethrow(error);
    }
  }

  private async loadContext(context: Array<string | PackageIdentifier>) {
    const resolved: PackageIdentifier[] = [];
    for (const entry of context) {
      const pkg = await this.fpi.toPackageObject(entry);
      await this.fpi.install(pkg);
      resolved.push(pkg);

      const deps = await this.fpi.getDependencies(pkg);
      for (const [id, version] of Object.entries(deps || {})) {
        const depPkg = { id, version };
        if (this.skipExamples && depPkg.id.includes('examples')) continue;
        await this.fpi.install(depPkg);
        resolved.push(depPkg);
      }
    }
    const deduped = new Map<string, PackageIdentifier>();
    for (const p of resolved) deduped.set(`${p.id}#${p.version}`, p);
    this.contextPackages = sortPackages(Array.from(deduped.values()));
  }

  private async collectDependencies(pkg: PackageIdentifier): Promise<Set<string>> {
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

  private async getFilePath(entry: FileIndexEntryWithPkg): Promise<string> {
    const dir = await this.fpi.getPackageDirPath({ id: entry.__packageId, version: entry.__packageVersion });
    return path.join(dir, 'package', entry.filename);
  }

  private buildFastIndex(index: FileIndexEntryWithPkg[]) {
    for (const file of index) {
      for (const key of getAllFastIndexKeys(file)) {
        if (!this.fastIndex.has(key)) this.fastIndex.set(key, []);
        this.fastIndex.get(key)!.push(file);
      }
    }
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
