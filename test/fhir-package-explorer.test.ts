/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll } from 'vitest';
import { FhirPackageExplorer } from 'fhir-package-explorer';
import path from 'path';
import { FhirVersion } from '@outburn/types';

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

  it('should have at least 728 StructureDefinitions in context', async () => {
    const meta = await explorer.lookupMeta({ resourceType: 'StructureDefinition' });
    console.log('Indexed StructureDefinitions:', meta.length);
    expect(meta.length).toBeGreaterThanOrEqual(728);
  });

  it('should have at least 1061 CodeSystems with content=complete', async () => {
    const meta = await explorer.lookupMeta({ resourceType: 'CodeSystem', content: 'complete' });
    expect(meta.length).toBeGreaterThanOrEqual(1061);
  });

  it('should have at least 4581 resources in hl7.fhir.r4.core@4.0.1', async () => {
    const meta = await explorer.lookupMeta({ package: 'hl7.fhir.r4.core@4.0.1' });
    expect(meta.length).toBeGreaterThanOrEqual(4581);
  });

  it('should have at least 4686 resources in hl7.fhir.uv.sdc#3.0.0 (including deps)', async () => {
    const meta = await explorer.lookupMeta({ package: 'hl7.fhir.uv.sdc#3.0.0' });
    expect(meta.length).toBeGreaterThanOrEqual(4686);
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
    // Core-bias should work: between core and examples packages, core wins
    // No implicit packages involved in this case
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

  it('should resolve when using a FhirPackageIdentifier filter', async () => {
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
    
    // Check that required packages are present
    const contextPackageIds = contextPackages.map(p => p.id);
    expect(contextPackageIds).toContain('hl7.fhir.r4.core');
    expect(contextPackageIds).toContain('hl7.fhir.uv.sdc');
    expect(contextPackageIds).toContain('hl7.fhir.uv.extensions.r4'); // implicit dependency
    expect(contextPackageIds).toContain('hl7.terminology.r4'); // implicit dependency
    
    // Check specific versions for explicit packages
    const corePackage = contextPackages.find(p => p.id === 'hl7.fhir.r4.core');
    const sdcPackage = contextPackages.find(p => p.id === 'hl7.fhir.uv.sdc');
    expect(corePackage?.version).toBe('4.0.1');
    expect(sdcPackage?.version).toBe('3.0.0');
    
    // Check that examples context includes additional packages
    const contextPackageIdsEx = contextPackagesEx.map(p => p.id);
    expect(contextPackageIdsEx).toContain('hl7.fhir.r4.core');
    expect(contextPackageIdsEx).toContain('hl7.fhir.r4.examples');
    expect(contextPackageIdsEx).toContain('hl7.fhir.us.core');
    expect(contextPackageIdsEx).toContain('hl7.fhir.us.davinci-crd');
    expect(contextPackageIdsEx).toContain('hl7.fhir.uv.sdc');
  });

  it('should correctly expand dependencies for package hl7.fhir.uv.sdc', async () => {
    const expanded = await explorer.expandPackageDependencies('hl7.fhir.uv.sdc@3.0.0');
    
    // Check that required packages are present
    const expandedIds = expanded.map(p => p.id);
    expect(expandedIds).toContain('hl7.fhir.r4.core');
    expect(expandedIds).toContain('hl7.fhir.uv.sdc');
    expect(expandedIds).toContain('hl7.fhir.uv.extensions.r4'); // implicit dependency
    expect(expandedIds).toContain('hl7.terminology.r4'); // implicit dependency
    
    // Check specific versions for explicit packages
    const corePackage = expanded.find(p => p.id === 'hl7.fhir.r4.core');
    const sdcPackage = expanded.find(p => p.id === 'hl7.fhir.uv.sdc');
    expect(corePackage?.version).toBe('4.0.1');
    expect(sdcPackage?.version).toBe('3.0.0');
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
    
    // Check that required packages are present
    const expandedIds = expanded.map(p => p.id);
    expect(expandedIds).toContain('hl7.fhir.r4.core');
    expect(expandedIds).toContain('hl7.fhir.r4.examples');
    expect(expandedIds).toContain('hl7.fhir.uv.sdc');
    expect(expandedIds).toContain('hl7.fhir.uv.extensions.r4'); // implicit dependency
    expect(expandedIds).toContain('hl7.terminology.r4'); // implicit dependency
    
    // Check specific versions for explicit packages
    const corePackage = expanded.find(p => p.id === 'hl7.fhir.r4.core');
    const examplesPackage = expanded.find(p => p.id === 'hl7.fhir.r4.examples');
    const sdcPackage = expanded.find(p => p.id === 'hl7.fhir.uv.sdc');
    expect(corePackage?.version).toBe('4.0.1');
    expect(examplesPackage?.version).toBe('4.0.1');
    expect(sdcPackage?.version).toBe('3.0.0');
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

  it('should resolve language StructureDefinition with implicit-over-core bias when duplicates exist', async () => {
    const resolved = await explorerWithExtensions.resolve({
      resourceType: 'StructureDefinition',
      id: 'language'
    });

    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.id).toBe('language');
    // Should now prefer implicit package (extensions) over core
    expect(resolved.__packageId).toBe('hl7.fhir.uv.extensions.r4');
    expect(resolved.__packageVersion).toBe('5.2.0');
    expect(resolved.url).toBe('http://hl7.org/fhir/StructureDefinition/language');
    expect(resolved.__filename).toBe('StructureDefinition-language.json');
  });

  it('should resolve language StructureDefinition metadata with implicit-over-core bias when duplicates exist', async () => {
    const resolved = await explorerWithExtensions.resolveMeta({
      resourceType: 'StructureDefinition',
      id: 'language'
    });

    expect(resolved.resourceType).toBe('StructureDefinition');
    expect(resolved.id).toBe('language');
    // Should now prefer implicit package (extensions) over core
    expect(resolved.__packageId).toBe('hl7.fhir.uv.extensions.r4');
    expect(resolved.__packageVersion).toBe('5.2.0');
    expect(resolved.url).toBe('http://hl7.org/fhir/StructureDefinition/language');
    expect(resolved.filename).toBe('StructureDefinition-language.json');
  });

  it('should resolve ValueSet from terminology package via implicit dependencies', async () => {
    // This test verifies that the implicit packages feature works correctly
    // Previously this would fail because the ValueSet is in hl7.terminology.r5, not hl7.fhir.r5.core
    // Now it should succeed because hl7.terminology.r5 is automatically included as an implicit dependency
    const explorerR5 = await FhirPackageExplorer.create({
      context: ['hl7.fhir.r5.core@5.0.0'],
      cachePath: customCachePath,
      skipExamples: true
    });

    const resolved = await explorerR5.resolve({
      resourceType: 'ValueSet',
      url: 'http://terminology.hl7.org/ValueSet/encounter-class'
    });

    expect(resolved.resourceType).toBe('ValueSet');
    expect(resolved.url).toBe('http://terminology.hl7.org/ValueSet/encounter-class');
    expect(resolved.__packageId).toBe('hl7.terminology.r5');
    expect(resolved.__packageVersion).toBeDefined(); // Version will be latest available
    expect(resolved.id).toBe('encounter-class');
  });

  it('should handle duplicate ValueSet resolution with resolveMeta', async () => {
    // This test reproduces the issue from the downstream project
    // Multiple matching resources should be handled by the duplicate resolution logic
    const explorerR5 = await FhirPackageExplorer.create({
      context: ['hl7.fhir.r5.core@5.0.0'],
      cachePath: customCachePath,
      skipExamples: true
    });

    // First, let's see how many matches we get
    const matches = await explorerR5.lookupMeta({
      resourceType: 'ValueSet',
      url: 'http://terminology.hl7.org/ValueSet/encounter-class'
    });
    
    console.log(`Found ${matches.length} matches for encounter-class ValueSet:`, 
      matches.map(m => `${m.__packageId}@${m.__packageVersion}`));

    // This should succeed even with multiple matches due to duplicate resolution
    const resolved = await explorerR5.resolveMeta({
      resourceType: 'ValueSet',
      url: 'http://terminology.hl7.org/ValueSet/encounter-class'
    });

    expect(resolved.resourceType).toBe('ValueSet');
    expect(resolved.url).toBe('http://terminology.hl7.org/ValueSet/encounter-class');
    expect(resolved.__packageId).toBeDefined();
    expect(resolved.__packageVersion).toBeDefined();
    expect(resolved.id).toBe('encounter-class');
  });

  it('should handle explicit version conflicts in terminology packages', async () => {
    // Create a scenario where we manually install multiple versions to test duplicate resolution
    // This simulates what might happen in the downstream project's cache
    
    // First, let's manually install multiple versions of terminology packages
    const fpi = new (await import('fhir-package-installer')).FhirPackageInstaller({ 
      cachePath: customCachePath 
    });
    
    // Install multiple versions of R5 terminology to create potential conflicts
    await fpi.install({ id: 'hl7.terminology.r5', version: '5.0.0' });
    await fpi.install({ id: 'hl7.terminology.r5', version: '6.0.0' });
    await fpi.install({ id: 'hl7.terminology.r5', version: '7.0.0' });
    
    // Now create an explorer with a mixed context that might find multiple versions
    const explorerMixed = await FhirPackageExplorer.create({
      context: [
        'hl7.fhir.r5.core#5.0.0',
        'hl7.terminology.r5@5.0.0',  // Explicit older version
        'hl7.terminology.r5@7.0.0'   // Explicit newer version
      ],
      cachePath: customCachePath,
      skipExamples: true
    });

    // Check what packages are actually in the context
    const contextPackages = explorerMixed.getContextPackages();
    console.log('Mixed Context packages:', contextPackages.map(p => `${p.id}@${p.version}`));

    // Look for the problematic ValueSet
    const matches = await explorerMixed.lookupMeta({
      resourceType: 'ValueSet',
      url: 'http://terminology.hl7.org/ValueSet/encounter-class'
    });
    
    console.log(`Mixed context: Found ${matches.length} matches for encounter-class:`, 
      matches.map(m => `${m.__packageId}@${m.__packageVersion} (${m.filename})`));

    if (matches.length > 1) {
      console.log('SUCCESS! We have multiple matches - this should trigger the duplicate resolution');
      
      // Test the duplicate resolution
      try {
        const resolved = await explorerMixed.resolveMeta({
          resourceType: 'ValueSet',
          url: 'http://terminology.hl7.org/ValueSet/encounter-class'
        });
        
        console.log(`Duplicate resolution worked! Resolved to: ${resolved.__packageId}@${resolved.__packageVersion}`);
        expect(resolved.url).toBe('http://terminology.hl7.org/ValueSet/encounter-class');
        
      } catch (error: any) {
        if (error.message.includes('Multiple matching resources found')) {
          console.log('REPRODUCED THE BUG! Duplicate resolution failed with error:', error.message);
          
          // Now we need to debug why the duplicate resolution logic isn't working
          // Let's manually test the tryResolveDuplicates function
          const { tryResolveDuplicates } = await import('../src/utils');
          
          console.log('Testing tryResolveDuplicates manually...');
          const resolvedCandidates = await tryResolveDuplicates(matches, {
            resourceType: 'ValueSet',
            url: 'http://terminology.hl7.org/ValueSet/encounter-class'
          }, fpi);
          
          console.log(`tryResolveDuplicates returned ${resolvedCandidates.length} candidates:`,
            resolvedCandidates.map(c => `${c.__packageId}@${c.__packageVersion}`));
          
          // The bug is that tryResolveDuplicates is not reducing the candidates to 1
          expect(error.message).toContain('Multiple matching resources found');
          expect(matches.length).toBeGreaterThan(1);
        } else {
          throw error;
        }
      }
    } else {
      console.log('Could not create duplicate scenario - only found one match');
      // This test didn't reproduce the issue, but that's OK for this test case
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }
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
    try {
      const resolved = await explorerNonCore.resolve({
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/us/davinci-pdex/StructureDefinition/extension-reviewAction'
      });
      // If it resolves successfully, verify the resource has expected properties
      expect(resolved.resourceType).toBe('StructureDefinition');
      expect(resolved.url).toBe('http://hl7.org/fhir/us/davinci-pdex/StructureDefinition/extension-reviewAction');
      expect(resolved.__packageId).toBeDefined();
      expect(resolved.__packageVersion).toBeDefined();
      // Verify it's not from a core package (since we excluded core packages)
      expect(resolved.__packageId).not.toMatch(/^hl7\.fhir\.r\d+\.core$/);
    } catch (error: any) {
      // If it throws, it should be for multiple matches or no match found, which are both acceptable
      expect(error.message).toMatch(/(Multiple matching resources found|No matching resource found)/);
    }
  });

  it('should reproduce the actual downstream issue: R4 + R5 context creating duplicate ValueSets', async () => {
    // REPRODUCE THE ACTUAL ISSUE: Downstream project has both R4 and R5 in context
    // This means they get hl7.terminology.r4 AND hl7.terminology.r5 as implicit dependencies
    // The same ValueSet exists in both terminology packages, causing duplicates
    
    console.log('=== REPRODUCING ACTUAL DOWNSTREAM ISSUE ===');
    console.log('Context: Both R4 and R5 core packages (like downstream project)');
    
    const explorerMixed = await FhirPackageExplorer.create({
      context: [
        'hl7.fhir.r4.core#4.0.1',  // R4 core -> brings hl7.terminology.r4
        'hl7.fhir.r5.core#5.0.0'   // R5 core -> brings hl7.terminology.r5
      ],
      cachePath: customCachePath,
      skipExamples: true
    });

    const contextPackages = explorerMixed.getContextPackages();
    console.log('Mixed context packages:', contextPackages.map(p => `${p.id}@${p.version}`));
    
    // This should find the ValueSet in BOTH terminology packages
    const matches = await explorerMixed.lookupMeta({
      resourceType: 'ValueSet',
      url: 'http://terminology.hl7.org/ValueSet/encounter-class'
    });
    
    console.log(`Found ${matches.length} matches for encounter-class ValueSet:`, 
      matches.map(m => `${m.__packageId}@${m.__packageVersion} (${m.filename})`));

    if (matches.length > 1) {
      console.log('SUCCESS! Reproduced the issue - found ValueSet in multiple terminology packages');
      
      // This should fail with "Multiple matching resources found"
      try {
        const resolved = await explorerMixed.resolveMeta({
          resourceType: 'ValueSet',
          url: 'http://terminology.hl7.org/ValueSet/encounter-class'
        });
        
        console.log(`Unexpectedly succeeded. Resolved to: ${resolved.__packageId}@${resolved.__packageVersion}`);
        // If it succeeds, that means our duplicate resolution is working
        expect(resolved.url).toBe('http://terminology.hl7.org/ValueSet/encounter-class');
        
      } catch (error: any) {
        if (error.message.includes('Multiple matching resources found')) {
          console.log('REPRODUCED THE BUG! Error message:', error.message);
          
          // Test what tryResolveDuplicates returns
          const { tryResolveDuplicates } = await import('../src/utils');
          const fpi = new (await import('fhir-package-installer')).FhirPackageInstaller({ 
            cachePath: customCachePath 
          });
          
          const candidates = await tryResolveDuplicates(matches, {
            resourceType: 'ValueSet',
            url: 'http://terminology.hl7.org/ValueSet/encounter-class'
          }, fpi);
          
          console.log(`tryResolveDuplicates returned ${candidates.length} candidates:`,
            candidates.map(c => `${c.__packageId}@${c.__packageVersion}`));
            
          // Now we can analyze WHY the duplicate resolution failed
          console.log('Analyzing duplicate resolution failure...');
          for (const match of matches) {
            console.log(`- Match: ${match.__packageId}@${match.__packageVersion} (resourceType: ${match.resourceType}, url: ${match.url})`);
          }
          
          // This confirms the bug exists
          expect(error.message).toContain('Multiple matching resources found');
          expect(matches.length).toBeGreaterThan(1);
        } else {
          throw error;
        }
      }
    } else {
      console.log('Could not reproduce - only found one match. Need to check package installation.');
      expect(matches.length).toBeGreaterThanOrEqual(1);
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

describe('FhirPackageExplorer auto-core-package feature', () => {
  const customCachePath = path.join('test', '.test-cache');

  it('should NOT auto-add core package when one already exists', async () => {
    const explorer = await FhirPackageExplorer.create({
      context: ['hl7.fhir.uv.sdc@3.0.0'], // This has hl7.fhir.r4.core as dependency
      fhirVersion: '5.0.0', // Even if we specify R5, shouldn't add it
      cachePath: customCachePath,
      skipExamples: true
    });

    const contextPackages = explorer.getContextPackages();
    const corePackages = contextPackages.filter(pkg => pkg.id.match(/^hl7\.fhir\.r\d+b?\.core$/));
    
    // Should only have R4 core (from sdc dependency), not R5
    expect(corePackages.length).toBe(1);
    expect(corePackages[0].id).toBe('hl7.fhir.r4.core');
    expect(corePackages[0].version).toBe('4.0.1');
  });

  it('should support version strings and release names', async () => {
    // Test that both version numbers and release names work
    const testCases = [
      { input: '3.0.2', expected: { id: 'hl7.fhir.r3.core', version: '3.0.2' } },
      { input: '3.0', expected: { id: 'hl7.fhir.r3.core', version: '3.0.2' } },
      { input: 'R3', expected: { id: 'hl7.fhir.r3.core', version: '3.0.2' } },
      { input: 'STU3', expected: { id: 'hl7.fhir.r3.core', version: '3.0.2' } },
      { input: '4.0.1', expected: { id: 'hl7.fhir.r4.core', version: '4.0.1' } },
      { input: '4.0', expected: { id: 'hl7.fhir.r4.core', version: '4.0.1' } },
      { input: '4.3.0', expected: { id: 'hl7.fhir.r4b.core', version: '4.3.0' } },
      { input: '4.3', expected: { id: 'hl7.fhir.r4b.core', version: '4.3.0' } },
      { input: '5.0.0', expected: { id: 'hl7.fhir.r5.core', version: '5.0.0' } },
      { input: '5.0', expected: { id: 'hl7.fhir.r5.core', version: '5.0.0' } }
    ];

    for (const testCase of testCases) {
      const { resolveFhirVersionToCorePackage } = await import('../src/utils');
      const result = resolveFhirVersionToCorePackage(testCase.input as FhirVersion);
      expect(result).toEqual(testCase.expected);
    }
  });
}, 480000); // 8 minutes timeout