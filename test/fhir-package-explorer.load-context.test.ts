/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { FhirPackageExplorer } from '../src/index';
import { FhirPackageInstaller } from 'fhir-package-installer';
import path from 'path';
import type { FileInPackageIndex } from '@outburn/types';

describe('FhirPackageExplorer load context', () => {
  const customCachePath = path.join('test', '.test-cache');

  it('should not reinstall the full dependency closure while loading context', async () => {
    const installCalls: string[] = [];
    const dependencyMap = new Map<string, Record<string, string>>([
      ['root.pkg#1.0.0', {
        'dep.a': '1.0.0',
        'dep.b': '2.0.0',
        'dep.shared': '3.0.0',
      }],
      ['dep.a#1.0.0', {}],
      ['dep.b#2.0.0', {}],
      ['dep.shared#3.0.0', {}],
    ]);

    const toPackageObject = async (pkg: string | { id: string; version: string }) => {
      if (typeof pkg !== 'string') {
        return pkg;
      }
      const [id, versionRaw] = pkg.includes('@') ? pkg.split('@', 2) : pkg.split('#', 2);
      return { id, version: versionRaw };
    };

    const getCachePathSpy = vi.spyOn(FhirPackageInstaller.prototype, 'getCachePath').mockReturnValue(customCachePath);
    const toPackageObjectSpy = vi.spyOn(FhirPackageInstaller.prototype, 'toPackageObject').mockImplementation(toPackageObject as any);
    const installSpy = vi.spyOn(FhirPackageInstaller.prototype, 'install').mockImplementation(async function (pkg: string | { id: string; version: string }) {
      const packageObject = await toPackageObject(pkg);
      installCalls.push(`${packageObject.id}#${packageObject.version}`);
      return true;
    });
    const getDependenciesSpy = vi.spyOn(FhirPackageInstaller.prototype, 'getDependencies').mockImplementation(async function (pkg: { id: string; version: string }) {
      const packageObject = await toPackageObject(pkg);
      return dependencyMap.get(`${packageObject.id}#${packageObject.version}`) ?? {};
    });

    try {
      const explorer = await FhirPackageExplorer.create({
        context: ['root.pkg@1.0.0'],
        cachePath: customCachePath,
        skipExamples: true,
      });

      expect(installCalls).toStrictEqual(['root.pkg#1.0.0']);
      expect(explorer.getContextPackages()).toStrictEqual([
        { id: 'dep.a', version: '1.0.0' },
        { id: 'dep.b', version: '2.0.0' },
        { id: 'dep.shared', version: '3.0.0' },
        { id: 'root.pkg', version: '1.0.0' },
      ]);
    } finally {
      getDependenciesSpy.mockRestore();
      installSpy.mockRestore();
      toPackageObjectSpy.mockRestore();
      getCachePathSpy.mockRestore();
    }
  });

  it('should scope package-filtered lookup to the root-aware dependency closure', async () => {
    const customIndexes = new Map<string, FileInPackageIndex[]>([
      ['root.pkg#1.0.0', [{ filename: 'root.json', resourceType: 'StructureDefinition', id: 'RootOnly', url: 'http://example.org/root' } as FileInPackageIndex]],
      ['hl7.fhir.r4.core#4.0.1', [{ filename: 'core.json', resourceType: 'StructureDefinition', id: 'CoreOnly', url: 'http://example.org/core' } as FileInPackageIndex]],
      ['hl7.terminology.r4#6.5.0', [{ filename: 'selected.json', resourceType: 'CodeSystem', id: 'SelectedTerm', url: 'http://example.org/selected-term', content: 'complete' } as FileInPackageIndex]],
      ['hl7.terminology.r4#7.1.0', [{ filename: 'latest.json', resourceType: 'CodeSystem', id: 'LatestTerm', url: 'http://example.org/latest-term', content: 'complete' } as FileInPackageIndex]],
    ]);
    const installCalls: string[] = [];

    const toPackageObject = async (pkg: string | { id: string; version: string }) => {
      if (typeof pkg !== 'string') {
        return pkg;
      }
      const [id, versionRaw] = pkg.includes('@') ? pkg.split('@', 2) : pkg.split('#', 2);
      return { id, version: versionRaw };
    };

    const getCachePathSpy = vi.spyOn(FhirPackageInstaller.prototype, 'getCachePath').mockReturnValue(customCachePath);
    const toPackageObjectSpy = vi.spyOn(FhirPackageInstaller.prototype, 'toPackageObject').mockImplementation(toPackageObject as any);
    const installSpy = vi.spyOn(FhirPackageInstaller.prototype, 'install').mockImplementation(async function (pkg: string | { id: string; version: string }) {
      const packageObject = await toPackageObject(pkg);
      installCalls.push(`${packageObject.id}#${packageObject.version}`);
      return true;
    });
    const getDependenciesSpy = vi.spyOn(FhirPackageInstaller.prototype, 'getDependencies').mockImplementation(async function (
      pkg: { id: string; version: string },
      options?: { rootPackage?: { id: string; version: string } }
    ) {
      const packageObject = await toPackageObject(pkg);
      const packageKey = `${packageObject.id}#${packageObject.version}`;
      if (packageKey === 'root.pkg#1.0.0') {
        return { 'hl7.fhir.r4.core': '4.0.1' };
      }
      if (packageKey === 'hl7.fhir.r4.core#4.0.1') {
        if (options?.rootPackage?.id === 'root.pkg' && options.rootPackage.version === '1.0.0') {
          return { 'hl7.terminology.r4': '6.5.0' };
        }
        return { 'hl7.terminology.r4': '7.1.0' };
      }
      return {};
    });
    const getPackageIndexFileSpy = vi.spyOn(FhirPackageInstaller.prototype, 'getPackageIndexFile').mockImplementation(async function (pkg: string | { id: string; version: string }) {
      const packageObject = await toPackageObject(pkg);
      return { files: customIndexes.get(`${packageObject.id}#${packageObject.version}`) ?? [] } as any;
    });

    try {
      const explorer = await FhirPackageExplorer.create({
        context: ['root.pkg@1.0.0'],
        cachePath: customCachePath,
        skipExamples: true,
      });

      const filtered = await explorer.lookupMeta({ package: 'root.pkg@1.0.0' });
      const ids = filtered.map((entry) => entry.id).sort();

      expect(ids).toEqual(['CoreOnly', 'RootOnly', 'SelectedTerm']);
      expect(ids).not.toContain('LatestTerm');
      expect(explorer.getContextPackages()).toEqual([
        { id: 'hl7.fhir.r4.core', version: '4.0.1' },
        { id: 'hl7.terminology.r4', version: '6.5.0' },
        { id: 'root.pkg', version: '1.0.0' },
      ]);
      expect(installCalls.filter((call) => call === 'root.pkg#1.0.0')).toHaveLength(2);
      expect(installCalls).toContain('hl7.fhir.r4.core#4.0.1');
      expect(installCalls).toContain('hl7.terminology.r4#6.5.0');
      expect(installCalls).not.toContain('hl7.terminology.r4#7.1.0');
    } finally {
      getPackageIndexFileSpy.mockRestore();
      getDependenciesSpy.mockRestore();
      installSpy.mockRestore();
      toPackageObjectSpy.mockRestore();
      getCachePathSpy.mockRestore();
    }
  });

  it('should preserve the owning root context for transitive package dependency reads', async () => {
    const customIndexes = new Map<string, FileInPackageIndex[]>([
      ['root.pkg#1.0.0', [{ filename: 'root.json', resourceType: 'StructureDefinition', id: 'RootOnly', url: 'http://example.org/root' } as FileInPackageIndex]],
      ['hl7.fhir.r4.core#4.0.1', [{ filename: 'core.json', resourceType: 'StructureDefinition', id: 'CoreOnly', url: 'http://example.org/core' } as FileInPackageIndex]],
      ['hl7.terminology.r4#6.5.0', [{ filename: 'selected.json', resourceType: 'CodeSystem', id: 'SelectedTerm', url: 'http://example.org/selected-term', content: 'complete' } as FileInPackageIndex]],
      ['hl7.terminology.r4#7.1.0', [{ filename: 'latest.json', resourceType: 'CodeSystem', id: 'LatestTerm', url: 'http://example.org/latest-term', content: 'complete' } as FileInPackageIndex]],
    ]);

    const toPackageObject = async (pkg: string | { id: string; version: string }) => {
      if (typeof pkg !== 'string') {
        return pkg;
      }
      const [id, versionRaw] = pkg.includes('@') ? pkg.split('@', 2) : pkg.split('#', 2);
      return { id, version: versionRaw };
    };

    const getCachePathSpy = vi.spyOn(FhirPackageInstaller.prototype, 'getCachePath').mockReturnValue(customCachePath);
    const toPackageObjectSpy = vi.spyOn(FhirPackageInstaller.prototype, 'toPackageObject').mockImplementation(toPackageObject as any);
    const installSpy = vi.spyOn(FhirPackageInstaller.prototype, 'install').mockResolvedValue(true);
    const getDependenciesSpy = vi.spyOn(FhirPackageInstaller.prototype, 'getDependencies').mockImplementation(async function (
      pkg: { id: string; version: string },
      options?: { rootPackage?: { id: string; version: string } }
    ) {
      const packageObject = await toPackageObject(pkg);
      const packageKey = `${packageObject.id}#${packageObject.version}`;
      if (packageKey === 'root.pkg#1.0.0') {
        return { 'hl7.fhir.r4.core': '4.0.1' };
      }
      if (packageKey === 'hl7.fhir.r4.core#4.0.1') {
        if (options?.rootPackage?.id === 'root.pkg' && options.rootPackage.version === '1.0.0') {
          return { 'hl7.terminology.r4': '6.5.0' };
        }
        return { 'hl7.terminology.r4': '7.1.0' };
      }
      return {};
    });
    const getPackageIndexFileSpy = vi.spyOn(FhirPackageInstaller.prototype, 'getPackageIndexFile').mockImplementation(async function (pkg: string | { id: string; version: string }) {
      const packageObject = await toPackageObject(pkg);
      return { files: customIndexes.get(`${packageObject.id}#${packageObject.version}`) ?? [] } as any;
    });

    try {
      const explorer = await FhirPackageExplorer.create({
        context: ['root.pkg@1.0.0'],
        cachePath: customCachePath,
        skipExamples: true,
      });

      const scoped = await explorer.lookupMeta({ package: 'hl7.fhir.r4.core@4.0.1' });
      const scopedIds = scoped.map((entry) => entry.id).sort();
      expect(scopedIds).toEqual(['CoreOnly', 'SelectedTerm']);
      expect(scopedIds).not.toContain('LatestTerm');

      const directDeps = await explorer.getDirectDependencies('hl7.fhir.r4.core@4.0.1');
      expect(directDeps).toEqual([{ id: 'hl7.terminology.r4', version: '6.5.0' }]);
    } finally {
      getPackageIndexFileSpy.mockRestore();
      getDependenciesSpy.mockRestore();
      installSpy.mockRestore();
      toPackageObjectSpy.mockRestore();
      getCachePathSpy.mockRestore();
    }
  });
});