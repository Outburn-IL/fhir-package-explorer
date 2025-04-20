/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  FhirPackageInstaller,
  PackageIdentifier,
  FileInPackageIndex,
  ILogger
} from 'fhir-package-installer';
import fs from 'fs-extra';

export interface FileIndexEntryWithPkg extends FileInPackageIndex {
  __packageId: string;
  __packageVersion: string;
}

export interface ExplorerConfig {
  logger?: ILogger;
  registryUrl?: string;
  cachePath?: string;
  context: Array<string | PackageIdentifier>;
}

export interface LookupFilter extends Partial<FileInPackageIndex> {
  package?: string | PackageIdentifier;
}

export class FhirPackageExplorer {
  private fpi: FhirPackageInstaller;
  private cachePath: string;
  private logger: ILogger;
  private indexCache = new Map<string, FileIndexEntryWithPkg[]>();
  private contentCache = new Map<string, any>();
  private fastIndex = new Map<string, FileIndexEntryWithPkg[]>();
  private contextPackages: PackageIdentifier[] = [];

  static async create(config: ExplorerConfig): Promise<FhirPackageExplorer> {
    const instance = new FhirPackageExplorer(config);
    await instance.loadContext(config.context);
    return instance;
  }

  private constructor(config: ExplorerConfig) {
    const { logger, registryUrl, cachePath } = config || {} as ExplorerConfig;
    this.fpi = new FhirPackageInstaller({
      logger,
      registryUrl,
      cachePath
    });
    this.logger = this.fpi.getLogger();
    this.cachePath = this.fpi.getCachePath();
  }

  public getCachePath(): string {
    return this.cachePath;
  }

  public getLogger(): ILogger {
    return this.logger;
  }

  async lookup(filter: LookupFilter = {}): Promise<any[]> {
    const meta = await this.lookupMeta(filter);
    const results = await Promise.all(meta.map(async (entry) => {
      const filePath = this.getFilePath(entry);
      if (this.contentCache.has(filePath)) return this.contentCache.get(filePath);
      const content = await this.loadJson(filePath);
      const enriched = {
        ...content,
        __packageId: entry.__packageId,
        __packageVersion: entry.__packageVersion
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
      const scopedPackage = await this.fpi.toPackageObject(normalizedFilter.package as string);
      allowedPackages = await this.collectDependencies(scopedPackage);
    }

    const result: FileIndexEntryWithPkg[] = [];
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
        this.buildFastIndex(pkg.id, pkg.version, index);
      }

      const fastKey = this.buildFastIndexKey(normalizedFilter as FileIndexEntryWithPkg);
      if (fastKey && this.fastIndex.has(fastKey)) {
        result.push(...this.fastIndex.get(fastKey)!);
        continue;
      }

      const filtered = index.filter(file => {
        for (const [key, value] of Object.entries(normalizedFilter)) {
          if (key === 'package') continue;
          if ((file as any)[key] !== value) return false;
        }
        return true;
      });

      result.push(...filtered);
    }

    return result;
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
      const pkg = await this.fpi.toPackageObject(entry as string);
      await this.fpi.install(pkg);
      resolved.push(pkg);

      const deps = await this.fpi.getDependencies(pkg);
      for (const [id, version] of Object.entries(deps || {})) {
        const depPkg = { id, version };
        await this.fpi.install(depPkg);
        resolved.push(depPkg);
      }
    }
    const deduped = new Map<string, PackageIdentifier>();
    for (const p of resolved) deduped.set(`${p.id}#${p.version}`, p);
    this.contextPackages = Array.from(deduped.values());
  }

  private async collectDependencies(pkg: PackageIdentifier): Promise<Set<string>> {
    const visited = new Set<string>();
    const visit = async (p: PackageIdentifier) => {
      const key = `${p.id}#${p.version}`;
      if (visited.has(key)) return;
      visited.add(key);
      const deps = await this.fpi.getDependencies(p);
      for (const [id, version] of Object.entries(deps || {})) {
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

  private getFilePath(entry: FileIndexEntryWithPkg): string {
    const dir = this.fpi.getPackageDirPath({ id: entry.__packageId, version: entry.__packageVersion });
    return `${dir}/package/${entry.filename}`;
  }

  private async loadJson(filePath: string): Promise<any> {
    return await fs.readJson(filePath);
  }

  private buildFastIndex(pkgId: string, version: string, index: FileIndexEntryWithPkg[]) {
    for (const file of index) {
      const k = this.buildFastIndexKey(file);
      if (k) {
        if (!this.fastIndex.has(k)) this.fastIndex.set(k, []);
        this.fastIndex.get(k)!.push(file);
      }
    }
  }

  private buildFastIndexKey(entry: FileIndexEntryWithPkg): string | null {
    const { __packageId, __packageVersion, resourceType, url, id, name, version } = entry;
    if (__packageId && __packageVersion && resourceType && url) return `pkg:${__packageId}#${__packageVersion}|resourceType:${resourceType}|url:${url}`;
    if (resourceType && url && version) return `resourceType:${resourceType}|url:${url}|version:${version}`;
    if (resourceType && url) return `resourceType:${resourceType}|url:${url}`;
    if (url && version) return `url:${url}|version:${version}`;
    if (url) return `url:${url}`;
    if (resourceType && name && version) return `resourceType:${resourceType}|name:${name}|version:${version}`;
    if (resourceType && id && version) return `resourceType:${resourceType}|id:${id}|version:${version}`;
    if (resourceType && name) return `resourceType:${resourceType}|name:${name}`;
    if (resourceType && id) return `resourceType:${resourceType}|id:${id}`;
    return null;
  }
}

export { PackageIdentifier, FileInPackageIndex, ILogger };
