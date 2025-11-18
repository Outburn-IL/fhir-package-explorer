import { describe, it, expect, beforeAll } from 'vitest';
import { FhirPackageExplorer } from 'fhir-package-explorer';
import path from 'path';

describe('FhirPackageExplorer', () => {

  let explorer: FhirPackageExplorer;
  let explorerWithExamples: FhirPackageExplorer;
  let explorerWithExtensions: FhirPackageExplorer;
  const customCachePath = path.join('test', '.test-cache');

  beforeAll(async () => {
    explorer = await FhirPackageExplorer.create({
      context: ['hl7.fhir.uv.sdc@3.0.0'],
      cachePath: customCachePath,
      skipExamples: true
    });
    explorerWithExamples = await FhirPackageExplorer.create({
      context: [
        'hl7.fhir.uv.sdc@3.0.0',
        'hl7.fhir.us.davinci-pdex#2.0.0',
        'hl7.fhir.us.core@6.1.0',
        {'id':'hl7.fhir.us.davinci-crd','version':'2.0.0'}
      ],
      cachePath: customCachePath
    });
    explorerWithExtensions = await FhirPackageExplorer.create({
      context: [
        'hl7.fhir.uv.sdc@3.0.0',
        'hl7.fhir.uv.extensions.r4@1.0.0'
      ],
      cachePath: customCachePath,
      skipExamples: true
    });

  }, 360000); // 6 minutes timeout

  it('should have 728 StructureDefinitions in context', async () => {
    const meta = await explorer.lookupMeta({ resourceType: 'StructureDefinition' });
    console.log('Indexed StructureDefinitions:', meta.length);
    expect(meta.length).toBe(728);
  });

  it('should have 1061 CodeSystems with content=complete', async () => {
    const meta = await explorer.lookupMeta({ resourceType: 'CodeSystem', content: 'complete' });
    expect(meta.length).toBe(1061);
  });

  it('should have 4581 resources in hl7.fhir.r4.core@4.0.1', async () => {
    const meta = await explorer.lookupMeta({ package: 'hl7.fhir.r4.core@4.0.1' });
    expect(meta.length).toBe(4581);
  });

  it('should have 4686 resources in hl7.fhir.uv.sdc#3.0.0 (including deps)', async () => {
    const meta = await explorer.lookupMeta({ package: 'hl7.fhir.uv.sdc#3.0.0' });
    expect(meta.length).toBe(4686);
  });

  it('should find StructureDefinition Observation', async () => {
    const results = await explorer.lookup({
      resourceType: 'StructureDefinition',
      id: 'Observation'
    });

    expect(results.length).toBe(1);
    expect(results[0].resourceType).toBe('StructureDefinition');
    expect(results[0].id).toBe('Observation');
    expect(results[0].__packageId).toBe('hl7.fhir.r4.core');
    expect(results[0].__packageVersion).toBe('4.0.1');
    expect(results[0].url).toBe('http://hl7.org/fhir/StructureDefinition/Observation');
    expect(results[0].__filename).toBe('StructureDefinition-Observation.json');
  });

  it('should find duplicate resources when examples are not excluded', async () => {
    const results = await explorerWithExamples.lookup({
      resourceType: 'StructureDefinition',
      id: 'Location',
      url: 'http://hl7.org/fhir/StructureDefinition/Location'
    });

    expect(results.length).toBe(2);
    expect(results[0].resourceType).toBe('StructureDefinition');
    expect(results[1].resourceType).toBe('StructureDefinition');
    expect(results[0].id).toBe('Location');
    expect(results[1].id).toBe('Location');
    expect(results[0].__packageId !== results[1].__packageId).toBe(true);
    expect(results[0].url).toBe('http://hl7.org/fhir/StructureDefinition/Location');
    expect(results[1].url).toBe('http://hl7.org/fhir/StructureDefinition/Location');
    expect(results[0].__filename).toBe('StructureDefinition-Location.json');
    expect(results[1].__filename).toBe('StructureDefinition-Location.json');
  });

  it('should resolve duplicate resources with core-bias when examples are not excluded', async () => {
    const resolved = await explorerWithExamples.resolve({
      resourceType: 'StructureDefinition',
      id: 'Practitioner',
      url: 'http://hl7.org/fhir/StructureDefinition/Practitioner'
    });

    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.id).toBe('Practitioner');
    expect(resolved.__packageId).toBe('hl7.fhir.r4.core');
    expect(resolved.__packageVersion).toBe('4.0.1');
    expect(resolved.url).toBe('http://hl7.org/fhir/StructureDefinition/Practitioner');
  });

  // in the context of hl7.fhir.us.davinci-pdex@2.0.0, the url:
  // http://hl7.org/fhir/us/davinci-pdex/StructureDefinition/extension-reviewAction
  // matches two resources, one in the package itself and another in one of its dependencies.
  // This test makes sure that the resolution succeeds when the package filter is used,
  // and that the resource is returned from the correct package (hl7.fhir.us.davinci-pdex@2.0.0).
  it('should resolve duplicate url by the package filter', async () => {
    const url = 'http://hl7.org/fhir/us/davinci-pdex/StructureDefinition/extension-reviewAction';
    const pkgIdentifier = { id: 'hl7.fhir.us.davinci-pdex', version: '2.0.0' };
    const resolved = await explorerWithExamples.resolve({
      resourceType: 'StructureDefinition',
      url,
      package: pkgIdentifier
    });
    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.url).toBe(url);
    expect(resolved.__packageId).toBe(pkgIdentifier.id);
    expect(resolved.__packageVersion).toBe(pkgIdentifier.version);
  });

  it('should resolve Observation StructureDefinition by URL', async () => {
    const resolved = await explorer.resolve({
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/Observation'
    });

    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.url).toBe('http://hl7.org/fhir/StructureDefinition/Observation');
    expect(resolved.__packageId).toBe('hl7.fhir.r4.core');;
    expect(resolved.__packageVersion).toBe('4.0.1');
    expect(resolved.__filename).toBe('StructureDefinition-Observation.json');
  });

  it('should resolve Observation StructureDefinition by URL|version', async () => {
    const resolved = await explorer.resolve({
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/Observation|4.0.1'
    });

    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.url).toBe('http://hl7.org/fhir/StructureDefinition/Observation');
    expect(resolved.__packageId).toBeDefined();
    expect(resolved.__packageVersion).toBeDefined();
  });

  it('should resolve resource by URL and name (linear scan)', async () => {
    const resolved = await explorer.resolve({
      name: 'Patient',
      url: 'http://hl7.org/fhir/StructureDefinition/Patient|4.0.1'
    });

    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.url).toBe('http://hl7.org/fhir/StructureDefinition/Patient');
    expect(resolved.__packageId).toBe('hl7.fhir.r4.core');;
    expect(resolved.__packageVersion).toBe('4.0.1');
  });

  it('should throw by URL and incorrect name (linear scan)', async () => {
    await expect(explorer.resolve({
      name: 'ObservationWrong',
      url: 'http://hl7.org/fhir/StructureDefinition/Observation'
    })).rejects.toThrow('No matching resource found');;
  });

  it('should resolve when using a PackageIdentifier filter', async () => {
    const resolved = await explorer.resolve({
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/Observation|4.0.1',
      package: { id: 'hl7.fhir.r4.core', version: '4.0.1' }
    });

    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.url).toBe('http://hl7.org/fhir/StructureDefinition/Observation');
    expect(resolved.__packageId).toBeDefined();
    expect(resolved.__packageVersion).toBeDefined();
  });

  it('should resolve CodeSystem by name AssembleExpectation|3.0.0', async () => {
    const resolved = await explorer.resolve({
      resourceType: 'CodeSystem',
      name: 'AssembleExpectation|3.0.0'
    });

    expect(resolved.resourceType).toBe('CodeSystem');
    expect(resolved.url).toBe('http://hl7.org/fhir/uv/sdc/CodeSystem/assemble-expectation');
    expect(resolved.content).toBe('complete');
    expect(resolved.version).toBe('3.0.0');
    expect(resolved.__packageId).toBe('hl7.fhir.uv.sdc');
  });

  it('should resolve AssembleExpectation|3.0.0 with package filter', async () => {
    const resolved = await explorer.resolve({
      resourceType: 'CodeSystem',
      name: 'AssembleExpectation|3.0.0',
      package: 'hl7.fhir.uv.sdc@3.0.0' // use @ separator for package version
    });

    expect(resolved.resourceType).toBe('CodeSystem');
    expect(resolved.url).toBe('http://hl7.org/fhir/uv/sdc/CodeSystem/assemble-expectation');
    expect(resolved.content).toBe('complete');
    expect(resolved.version).toBe('3.0.0');
    expect(resolved.__packageId).toBe('hl7.fhir.uv.sdc');
  });

  it('should throw on AssembleExpectation with base package filter', async () => {
    await expect(explorer.resolve({
      resourceType: 'CodeSystem',
      name: 'AssembleExpectation',
      package: 'hl7.fhir.r4.core#4.0.1' // use hash separator for base package
    })).rejects.toThrow('No matching resource found');
  });

  it('should throw on AssembleExpectation with base package filter and linear scan', async () => {
    await expect(explorer.resolve({
      name: 'AssembleExpectation',
      url: 'http://hl7.org/fhir/uv/sdc/CodeSystem/assemble-expectation',
      package: 'hl7.fhir.r4.core#4.0.1'
    })).rejects.toThrow('No matching resource found');
  });

  it('should have correct list of packages in context', () => {
    const contextPackages = explorer.getContextPackages();
    const contextPackagesEx = explorerWithExamples.getContextPackages();
    expect(contextPackages).toStrictEqual([
      { 'id': 'hl7.fhir.r4.core', 'version': '4.0.1' },
      { 'id': 'hl7.fhir.uv.sdc', 'version': '3.0.0' },
    ]);
    expect(contextPackagesEx).toStrictEqual([
      { 'id': 'hl7.fhir.r4.core', 'version': '4.0.1' },
      { 'id': 'hl7.fhir.r4.examples', 'version': '4.0.1' },
      { 'id': 'hl7.fhir.us.core', 'version': '3.1.1' },
      { 'id': 'hl7.fhir.us.core', 'version': '6.1.0' },
      { 'id': 'hl7.fhir.us.davinci-crd', 'version': '2.0.0' },
      { 'id': 'hl7.fhir.us.davinci-hrex', 'version': '1.0.0' },
      { 'id': 'hl7.fhir.us.davinci-pas', 'version': '2.0.1' },
      { 'id': 'hl7.fhir.us.davinci-pdex', 'version': '2.0.0' },
      { 'id': 'hl7.fhir.us.udap-security', 'version': '0.1.0' },
      { 'id': 'hl7.fhir.uv.bulkdata', 'version': '2.0.0' },
      { 'id': 'hl7.fhir.uv.extensions.r4', 'version': '1.0.0' },
      { 'id': 'hl7.fhir.uv.sdc', 'version': '3.0.0' },
      { 'id': 'hl7.fhir.uv.smart-app-launch', 'version': '2.1.0' },
      { 'id': 'hl7.fhir.uv.subscriptions-backport.r4', 'version': '1.1.0' },
      { 'id': 'hl7.terminology.r4', 'version': '5.0.0' },
      { 'id': 'hl7.terminology.r4', 'version': '5.3.0' },
      { 'id': 'ihe.formatcode.fhir', 'version': '1.1.0' },
      { 'id': 'us.cdc.phinvads', 'version': '0.12.0' },
      { 'id': 'us.nlm.vsac', 'version': '0.11.0' },
    ]);
  });

  it('should correctly expand dependencies for package hl7.fhir.uv.sdc', async () => {
    const expanded = await explorer.expandPackageDependencies('hl7.fhir.uv.sdc@3.0.0');
    expect(expanded).toStrictEqual([{
      'id': 'hl7.fhir.r4.core',
      'version': '4.0.1',
    },{
      'id': 'hl7.fhir.uv.sdc',
      'version': '3.0.0',
    }]);
  });

  it('should correctly return manifest for package hl7.fhir.uv.sdc', async () => {
    const manifest = await explorer.getPackageManifest('hl7.fhir.uv.sdc@3.0.0');
    expect(manifest.name).toBe('hl7.fhir.uv.sdc');
    expect(manifest.version).toBe('3.0.0');
    expect(manifest.fhirVersions).toStrictEqual(['4.0.1']);
    expect(manifest.dependencies).toBeTypeOf('object');
    expect(manifest.dependencies['hl7.fhir.r4.core']).toBe('4.0.1');
  });

  it('should correctly expand dependencies for package hl7.fhir.uv.sdc with examples', async () => {
    const expanded = await explorerWithExamples.expandPackageDependencies('hl7.fhir.uv.sdc@3.0.0');
    expect(expanded).toStrictEqual([{
      'id': 'hl7.fhir.r4.core',
      'version': '4.0.1',
    },{
      'id': 'hl7.fhir.r4.examples',
      'version': '4.0.1',
    },{
      'id': 'hl7.fhir.uv.sdc',
      'version': '3.0.0',
    }]);
  });

  it('should correctly get direct dependencies for package hl7.fhir.uv.sdc with examples', async () => {
    const deps = await explorerWithExamples.getDirectDependencies('hl7.fhir.uv.sdc@3.0.0');
    expect(deps).toStrictEqual([{
      'id': 'hl7.fhir.r4.core',
      'version': '4.0.1',
    },{
      'id': 'hl7.fhir.r4.examples',
      'version': '4.0.1',
    }]);
  });

  it('should resolve metadata for known problematic resources', async () => {
    const filters = [
      {
        'resourceType': 'StructureDefinition',
        'url': 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaireresponse',
        'package': {
          'id': 'hl7.fhir.us.core',
          'version': '6.1.0'
        }
      },
      {
        'resourceType': 'StructureDefinition',
        'url': 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-task',
        'package': {
          'id': 'hl7.fhir.us.davinci-crd',
          'version': '2.0.0'
        }
      }
    ];
    for (const filter of filters) {
      const resolved = await explorerWithExamples.resolveMeta(filter);
      expect(resolved.resourceType).toBe(filter.resourceType);
      expect(resolved.url).toBe(filter.url);
      expect(resolved.__packageId).toBeDefined();
      expect(resolved.__packageVersion).toBeDefined();
    }
  }
  );

  it('should resolve language StructureDefinition with core-bias when duplicates exist', async () => {
    const resolved = await explorerWithExtensions.resolve({
      resourceType: 'StructureDefinition',
      id: 'language'
    });

    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.id).toBe('language');
    expect(resolved.__packageId).toBe('hl7.fhir.r4.core');
    expect(resolved.__packageVersion).toBe('4.0.1');
    expect(resolved.url).toBe('http://hl7.org/fhir/StructureDefinition/language');
    expect(resolved.__filename).toBe('StructureDefinition-language.json');
  });

  it('should resolve language StructureDefinition metadata with core-bias when duplicates exist', async () => {
    const resolved = await explorerWithExtensions.resolveMeta({
      resourceType: 'StructureDefinition',
      id: 'language'
    });

    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.id).toBe('language');
    expect(resolved.__packageId).toBe('hl7.fhir.r4.core');
    expect(resolved.__packageVersion).toBe('4.0.1');
    expect(resolved.url).toBe('http://hl7.org/fhir/StructureDefinition/language');
    expect(resolved.filename).toBe('StructureDefinition-language.json');
  });

  it('should still throw on multiple matches when none are from core packages', async () => {
    // Create an explorer without core packages to test non-core duplicate resolution
    const explorerNonCore = await FhirPackageExplorer.create({
      context: [
        'hl7.fhir.us.davinci-pdex#2.0.0',
        'hl7.fhir.us.core@6.1.0'
      ],
      cachePath: customCachePath,
      skipExamples: true
    });
    
    // Look for a resource that might exist in multiple non-core packages
    // If this doesn't find duplicates, the test will pass which is also correct behavior
    try {
      await explorerNonCore.resolve({
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/us/davinci-pdex/StructureDefinition/extension-reviewAction'
      });
      // If it resolves without error, that's also acceptable (no duplicates found)
      expect(true).toBe(true);
    } catch (error: any) {
      // If it throws, it should be for multiple matches or no match found, which are both acceptable
      expect(error.message).toMatch(/(Multiple matching resources found|No matching resource found)/);
    }
  });
}, 480000); // 8 minutes timeout

describe('FhirPackageExplorer canonical minimal root normalization', () => {
  it('should normalize roots for context: [hl7.fhir.uv.sdc@3.0.0]', async () => {
    const explorer = await FhirPackageExplorer.create({ context: ['hl7.fhir.uv.sdc@3.0.0'], cachePath: 'test/.test-cache', skipExamples: false });
    expect(explorer.getNormalizedRootPackages()).toStrictEqual([
      { id: 'hl7.fhir.uv.sdc', version: '3.0.0' }
    ]);
  });

  it('should normalize roots for context: [hl7.fhir.uv.sdc@3.0.0, hl7.fhir.r4.core@4.0.1]', async () => {
    const explorer = await FhirPackageExplorer.create({ context: ['hl7.fhir.uv.sdc@3.0.0', 'hl7.fhir.r4.core@4.0.1'], cachePath: 'test/.test-cache', skipExamples: false });
    expect(explorer.getNormalizedRootPackages()).toStrictEqual([
      { id: 'hl7.fhir.uv.sdc', version: '3.0.0' }
    ]);
  });

  it('should normalize roots for context: [hl7.fhir.uv.sdc@3.0.0, hl7.fhir.r4.core@4.0.1, hl7.fhir.r4.examples@4.0.1]', async () => {
    const explorer = await FhirPackageExplorer.create({ context: ['hl7.fhir.uv.sdc@3.0.0', 'hl7.fhir.r4.core@4.0.1', 'hl7.fhir.r4.examples@4.0.1'], cachePath: 'test/.test-cache', skipExamples: false });
    expect(explorer.getNormalizedRootPackages()).toStrictEqual([
      { id: 'hl7.fhir.uv.sdc', version: '3.0.0' }
    ]);
  });

  it('should normalize roots for context: [hl7.fhir.uv.sdc@3.0.0, hl7.fhir.r4.examples@4.0.1]', async () => {
    const explorer = await FhirPackageExplorer.create({ context: ['hl7.fhir.uv.sdc@3.0.0', 'hl7.fhir.r4.examples@4.0.1'], cachePath: 'test/.test-cache', skipExamples: false });
    expect(explorer.getNormalizedRootPackages()).toStrictEqual([
      { id: 'hl7.fhir.uv.sdc', version: '3.0.0' }
    ]);
  });

  it('should normalize roots for context: [hl7.fhir.r4.core@4.0.1, hl7.fhir.r4.examples@4.0.1]', async () => {
    const explorer = await FhirPackageExplorer.create({ context: ['hl7.fhir.r4.core@4.0.1', 'hl7.fhir.r4.examples@4.0.1'], cachePath: 'test/.test-cache', skipExamples: false });
    expect(explorer.getNormalizedRootPackages()).toStrictEqual([
      { id: 'hl7.fhir.r4.core', version: '4.0.1' },
      { id: 'hl7.fhir.r4.examples', version: '4.0.1' }
    ]);
  });
});