/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  FhirPackageInstaller,
  PackageIdentifier,
  FileInPackageIndex,
  ILogger
} from 'fhir-package-installer';
import fs from 'fs-extra';
import path from 'path';

export interface FileIndexEntryWithPkg extends FileInPackageIndex {
  __packageId: string;
  __packageVersion: string;
}

export interface ExplorerConfig {
  logger?: ILogger;
  registryUrl?: string;
  cachePath?: string;
  context: Array<string | PackageIdentifier>;
  skipExamples?: boolean;
}

export interface LookupFilter extends Partial<FileInPackageIndex> {
  package?: string | PackageIdentifier;
}

const sortPackages = (arr: PackageIdentifier[]) => {
  return arr.slice().sort((a, b) => {
    const aKey = `${a.id}@${a.version}`;
    const bKey = `${b.id}@${b.version}`;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
};

export class FhirPackageExplorer {
  private fpi: FhirPackageInstaller;
  private cachePath: string;
  private logger: ILogger;
  private indexCache = new Map<string, FileIndexEntryWithPkg[]>();
  private contentCache = new Map<string, any>();
  private fastIndex = new Map<string, FileIndexEntryWithPkg[]>();
  private contextPackages: PackageIdentifier[] = [];
  private skipExamples: boolean = false;

  static async create(config: ExplorerConfig): Promise<FhirPackageExplorer> {
    const instance = new FhirPackageExplorer(config);
    await instance.loadContext(config.context);
    return instance;
  }

  private constructor(config: ExplorerConfig) {
    const { logger, registryUrl, cachePath, skipExamples } = config || {} as ExplorerConfig;
    this.fpi = new FhirPackageInstaller({ logger, registryUrl, cachePath, skipExamples });
    this.logger = this.fpi.getLogger();
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

  async lookup(filter: LookupFilter = {}): Promise<any[]> {
    const meta = await this.lookupMeta(filter);
    const results = await Promise.all(meta.map(async (entry) => {
      const filePath = await this.getFilePath(entry);
      if (this.contentCache.has(filePath)) return this.contentCache.get(filePath);
      const content = await this.loadJson(filePath);
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

  async lookupMeta(filter: LookupFilter = {}): Promise<FileIndexEntryWithPkg[]> {
    const normalizedFilter = this.normalizePipedFilter(filter);
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

      const fastKeys = this.getAllFastIndexKeys(normalizedFilter as FileIndexEntryWithPkg);
      const fastCandidates = fastKeys.flatMap(k => this.fastIndex.get(k) ?? []);

      const candidates = fastCandidates.length > 0 ? fastCandidates : index;

      for (const entry of candidates) {
        const entryPkgKey = `${entry.__packageId}#${entry.__packageVersion}`;
        if (allowedPackages && !allowedPackages.has(entryPkgKey)) continue;
        if (!this.matchesFilter(entry, normalizedFilter)) continue;
        const compositeKey = `${entry.filename}|${entry.__packageId}|${entry.__packageVersion}`;
        if (!resultMap.has(compositeKey)) {
          resultMap.set(compositeKey, entry);
        }
      }
    }

    return Array.from(resultMap.values());
  }

  async resolve(filter: LookupFilter = {}): Promise<any> {
    const matches = await this.lookup(filter);
    if (matches.length === 0) throw new Error('No matching resource found');
    if (matches.length > 1) {
      const candidates = this.tryResolveSemver(matches);
      if (candidates.length !== 1) throw new Error('Multiple matching resources found');
      return candidates[0];
    }
    return matches[0];
  }

  async resolveMeta(filter: LookupFilter = {}): Promise<FileIndexEntryWithPkg> {
    const matches = await this.lookupMeta(filter);
    if (matches.length === 0) throw new Error('No matching resource found');
    if (matches.length > 1) {
      const candidates = this.tryResolveSemver(matches);
      if (candidates.length !== 1) throw new Error('Multiple matching resources found');
      return candidates[0];
    }
    return matches[0];
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

  private normalizePipedFilter(filter: LookupFilter): LookupFilter {
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
  }

  private matchesFilter(entry: FileIndexEntryWithPkg, filter: LookupFilter): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (key === 'package') continue;
      if ((entry as any)[key] !== value) return false;
    }
    return true;
  }

  private tryResolveSemver(matches: FileIndexEntryWithPkg[]): FileIndexEntryWithPkg[] {
    const groupedByPkg = new Map<string, string[]>();
    for (const entry of matches) {
      const pkg = entry.__packageId;
      const v = entry.version;
      if (!v || !/\d+\.\d+\.\d+/.test(v)) return [];
      if (!groupedByPkg.has(pkg)) groupedByPkg.set(pkg, []);
      groupedByPkg.get(pkg)!.push(v);
    }
    if (groupedByPkg.size !== 1) return [];
    const [pkgId, versions] = Array.from(groupedByPkg.entries())[0];
    const latest = versions.sort((a, b) => (a > b ? 1 : -1)).pop();
    return matches.filter(m => m.__packageId === pkgId && m.version === latest);
  }

  private async getFilePath(entry: FileIndexEntryWithPkg): Promise<string> {
    const dir = await this.fpi.getPackageDirPath({ id: entry.__packageId, version: entry.__packageVersion });
    return path.join(dir, 'package', entry.filename);
  }

  private async loadJson(filePath: string): Promise<any> {
    return await fs.readJson(filePath);
  }

  private buildFastIndex(index: FileIndexEntryWithPkg[]) {
    for (const file of index) {
      for (const key of this.getAllFastIndexKeys(file)) {
        if (!this.fastIndex.has(key)) this.fastIndex.set(key, []);
        this.fastIndex.get(key)!.push(file);
      }
    }
  }

  private getAllFastIndexKeys(entry: FileIndexEntryWithPkg): string[] {
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
  }
}

export { PackageIdentifier, FileInPackageIndex, ILogger };
