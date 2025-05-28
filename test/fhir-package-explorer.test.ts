import { describe, it, expect, beforeAll } from 'vitest';
import { FhirPackageExplorer } from 'fhir-package-explorer';
import path from 'path';
import { remove } from 'fs-extra';

describe('FhirPackageExplorer', () => {

  let explorer: FhirPackageExplorer;
  let explorerWithExamples: FhirPackageExplorer;
  const customCachePath = path.join('test', '.test-cache');

  beforeAll(async () => {
    // cleanup before running tests
    await remove(customCachePath);
    explorer = await FhirPackageExplorer.create({
      context: ['hl7.fhir.uv.sdc@3.0.0'],
      cachePath: customCachePath,
      skipExamples: true
    });
    explorerWithExamples = await FhirPackageExplorer.create({
      context: ['hl7.fhir.uv.sdc@3.0.0', 'hl7.fhir.us.davinci-pdex#2.0.0'],
      cachePath: customCachePath
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

  it('should throw on duplicate resources when examples are not excluded', async () => {
    await expect(explorerWithExamples.resolve({
      resourceType: 'StructureDefinition',
      id: 'Practitioner',
      url: 'http://hl7.org/fhir/StructureDefinition/Practitioner'
    })).rejects.toThrow('Multiple matching resources found');
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

    expect(contextPackages).toStrictEqual([{
      'id': 'hl7.fhir.r4.core',
      'version': '4.0.1',
    },{
      'id': 'hl7.fhir.uv.sdc',
      'version': '3.0.0',
    }]);

    expect(contextPackagesEx).toStrictEqual([{
      'id': 'hl7.fhir.r4.core',
      'version': '4.0.1',
    },{
      'id': 'hl7.fhir.r4.examples',
      'version': '4.0.1',
    },
    {
      'id': 'hl7.fhir.us.core',
      'version': '3.1.1',
    },
    {
      'id': 'hl7.fhir.us.davinci-hrex',
      'version': '1.0.0',
    },
    {
      'id': 'hl7.fhir.us.davinci-pas',
      'version': '2.0.1',
    },
    {
      'id': 'hl7.fhir.us.davinci-pdex',
      'version': '2.0.0',
    },
    {
      'id': 'hl7.fhir.uv.extensions.r4',
      'version': '1.0.0',
    },
    {
      'id': 'hl7.fhir.uv.sdc',
      'version': '3.0.0',
    },
    {
      'id': 'hl7.terminology.r4',
      'version': '5.3.0',
    }]);
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
}, 480000); // 8 minutes timeout