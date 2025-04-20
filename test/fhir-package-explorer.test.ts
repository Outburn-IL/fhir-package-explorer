import { describe, it, expect, beforeAll } from 'vitest';
import { FhirPackageExplorer } from 'fhir-package-explorer';
import path from 'path';
import { remove } from 'fs-extra';

describe('FhirPackageExplorer', () => {

  let explorer: FhirPackageExplorer;
  const customCachePath = path.join('test', '.test-cache');

  beforeAll(async () => {
    // cleanup before running tests
    await remove(customCachePath);
    explorer = await FhirPackageExplorer.create({
      context: ['hl7.fhir.uv.sdc@3.0.0'],
      cachePath: customCachePath
    });
  }, 240000); // 4 minutes timeout

  it('should have 1386 StructureDefinitions in context', async () => {
    const meta = await explorer.lookupMeta({ resourceType: 'StructureDefinition' });
    console.log('Indexed StructureDefinitions:', meta.length);
    expect(meta.length).toBe(1386);
  });

  it('should have 2115 CodeSystems with content=complete', async () => {
    const meta = await explorer.lookupMeta({ resourceType: 'CodeSystem', content: 'complete' });
    console.log('Complete CodeSystems:', meta.length);
    expect(meta.length).toBe(2115);
  });

  it('should find StructureDefinition Observation', async () => {
    const results = await explorer.lookup({
      resourceType: 'StructureDefinition',
      id: 'Observation'
    });

    console.log('Lookup results:', results.length);
    for (const res of results) {
      console.log(res.id, res.url);
    }

    expect(results.length).toBeGreaterThan(0);
    for (const res of results) {
      expect(res.resourceType).toBe('StructureDefinition');
      expect(res.id).toBe('Observation');
      expect(res.__packageId).toBeDefined();
      expect(res.__packageVersion).toBeDefined();
    }
  });

  it('should resolve Observation StructureDefinition by URL', async () => {
    const resolved = await explorer.resolve({
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/Observation',
      package: 'hl7.fhir.r4.core@4.0.1'
    });

    console.log('Resolved resource:', resolved.id, resolved.url);

    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.url).toBe('http://hl7.org/fhir/StructureDefinition/Observation');
    expect(resolved.__packageId).toBeDefined();
    expect(resolved.__packageVersion).toBeDefined();
  });

  it('should resolve Observation StructureDefinition by URL|version', async () => {
    const resolved = await explorer.resolve({
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/Observation|4.0.1',
      package: 'hl7.fhir.r4.core@4.0.1'
    });

    console.log('Resolved resource:', resolved.id, resolved.url);

    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.url).toBe('http://hl7.org/fhir/StructureDefinition/Observation');
    expect(resolved.__packageId).toBeDefined();
    expect(resolved.__packageVersion).toBeDefined();
  });

  //AssembleExpectation
  it('should resolve CodeSystem by name AssembleExpectation|3.0.0', async () => {
    const resolved = await explorer.resolve({
      resourceType: 'CodeSystem',
      name: 'AssembleExpectation|3.0.0'
    });

    console.log('Resolved resource:', resolved.id, resolved.url);

    expect(resolved.resourceType).toBe('CodeSystem');
    expect(resolved.url).toBe('http://hl7.org/fhir/uv/sdc/CodeSystem/assemble-expectation');
    expect(resolved.content).toBe('complete');
    expect(resolved.version).toBe('3.0.0');
    expect(resolved.__packageId).toBe('hl7.fhir.uv.sdc');
  });
}, 480000); // 8 minutes timeout
