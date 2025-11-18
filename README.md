# FHIR Package Explorer

A fast, flexible utility for searching, filtering, and resolving conformance resources in [FHIR](https://hl7.org/fhir/) NPM-style packages — including transitive dependencies. Works hand-in-hand with [`fhir-package-installer`](https://www.npmjs.com/package/fhir-package-installer).

---

## ✨ Features

- Load and index a package context (including dependencies)
- Efficiently filter by `StructureDefinition`, `CodeSystem`, `ValueSet`, etc.
- Returns full content or index metadata
- Fast-path lookups with optional SemVer disambiguation
- Supports package-level filtering with dependency awareness
- Built-in memory cache for speed

---

## 📦 Installation

```bash
npm install fhir-package-explorer
```

---

## 🚀 Usage

```ts
import { FhirPackageExplorer } from 'fhir-package-explorer';

const explorer = await FhirPackageExplorer.create({
  context: ['hl7.fhir.uv.sdc@3.0.0']
});

const results = await explorer.lookup({
  resourceType: 'StructureDefinition',
  id: 'Observation'
});

const resolved = await explorer.resolve({
  resourceType: 'StructureDefinition',
  url: 'http://hl7.org/fhir/StructureDefinition/Observation',
  package: 'hl7.fhir.r4.core@4.0.1' // This package is in context since it is a dependency of `hl7.fhir.uv.sdc@3.0.0`
});
```

---

## 🔍 API

### `FhirPackageExplorer.create(config: ExplorerConfig): Promise<FhirPackageExplorer>`

Factory method that installs context packages (and their dependencies) before returning a ready-to-use instance.

- `context` — **required**. Array of FHIR packages (strings or `{ id, version }`). Dependecies are automatically loaded.
- `logger` — optional. Custom logger implementing `ILogger`.
- `registryUrl`, `registryToken`, `cachePath`, `skipExamples` — optional. Passed through to [`fhir-package-installer`](https://www.npmjs.com/package/fhir-package-installer).

---

### `lookup(filter: LookupFilter): Promise<any[]>`

Returns full content of matching resources, each enriched with:

```ts
{
  ...originalResource,
  __packageId: string;
  __packageVersion: string;
}
```

---

### `lookupMeta(filter: LookupFilter): Promise<FileInPackageIndex[]>`

Same as `lookup`, but returns the resource index metadata only.

---

### `resolve(filter: LookupFilter): Promise<any>`

Returns a single matching resource. Throws if:
- No match found
- Multiple matches found **unless** they can be resolved by:
  - SemVer-compatible versions of the same package, or
  - **Core-bias resolution**: when exactly one match comes from a core/base package (`hl7.fhir.rX.core`), it is preferred as the canonical definition

---

### `resolveMeta(filter: LookupFilter): Promise<FileInPackageIndex>`

Same as `resolve`, but returns metadata only. Uses the same duplicate resolution logic including core-bias resolution.

---

### `getLogger(): ILogger`

Returns the internal logger used by this instance.

---

### `getCachePath(): string`

Returns the resolved cache directory used for storing FHIR packages.

---



### `getDirectDependencies(pkg: string | { id, version }): Promise<{ id, version }[]>`

Returns the direct dependencies of a given FHIR package (does not include transitive dependencies).

**Example:**

```ts
const explorer = await FhirPackageExplorer.create({ context: ['hl7.fhir.uv.sdc@3.0.0'] });
const deps = await explorer.getDirectDependencies('hl7.fhir.uv.sdc@3.0.0');
// deps: [ { id: 'hl7.fhir.r4.core', version: '4.0.1' }, { id: 'hl7.fhir.r4.examples', version: '4.0.1' } ]
```

---

### `getPackageManifest(pkg: string | { id, version }): Promise<any>`


Returns the parsed `package.json` manifest for the specified FHIR package.

**Example:**

```ts
const explorer = await FhirPackageExplorer.create({ context: ['hl7.fhir.uv.sdc@3.0.0'] });
const manifest = await explorer.getPackageManifest('hl7.fhir.uv.sdc@3.0.0');
console.log(manifest.name); // 'hl7.fhir.uv.sdc'
console.log(manifest.version); // '3.0.0'
```

---

### `getContextPackages(): { id, version }[]`

Returns the sorted, de-duplicated, dependency-resolved list of FHIR packages in context.

---

### `getNormalizedRootPackages(): { id, version }[]`

Returns the minimal, canonical set of root packages from the context. This is the smallest set of packages such that all other context packages are dependencies of these roots. Redundant roots (those that are dependencies of other roots) are removed.

**Example:**

```ts
const explorer = await FhirPackageExplorer.create({
  context: [
    'hl7.fhir.uv.sdc@3.0.0',
    'hl7.fhir.r4.core@4.0.1', // redundant, already a dependency of sdc
    'hl7.fhir.r4.examples@4.0.1' // redundant, already a dependency of sdc
  ]
});
console.log(explorer.getNormalizedRootPackages());
// Output: [ { id: 'hl7.fhir.uv.sdc', version: '3.0.0' } ]
```

---

### `expandPackageDependencies(string | { id, version }): Promise<{ id, version }[]>`

Expands a package into the full list of related packages. The returned array includes the requested package itself and all transitive dependencies, and is de-duplicated and sorted.

---

## 🎯 Duplicate Resolution

When multiple resources match a filter, FhirPackageExplorer attempts to resolve duplicates intelligently:

1. **Package Filter Priority**: If a `package` filter is provided and exactly one match comes from that package, it is returned.

2. **Core-bias Resolution**: If exactly one match comes from a core/base package (matching pattern `hl7.fhir.rX.core`), it is preferred as the canonical definition. This helps resolve naming collisions between base FHIR resources and their duplicates in extension packages.

3. **SemVer Resolution**: If matches come from different versions of the same package, the resource from the latest semantic version is returned.

4. **Error**: If none of the above rules apply, an error is thrown for multiple matches.

**Example:**
```ts
// If both hl7.fhir.r4.core and hl7.fhir.uv.extensions.r4 contain a 'language' StructureDefinition,
// the one from hl7.fhir.r4.core will be preferred due to core-bias
const resolved = await explorer.resolve({
  resourceType: 'StructureDefinition',
  id: 'language'
});
// resolved.__packageId === 'hl7.fhir.r4.core'
```

---

## 🔧 LookupFilter

You can filter using any combination of fields from the `.fpi.index.json`, including:

- `resourceType`
- `id`
- `url`
- `name`
- `version`
- and more...

You can also restrict the search to a specific package **and its dependencies**:

```ts
{
  package: 'hl7.fhir.uv.sdc#3.0.0'
}
```

---

## 📁 File Access

This library uses the `.fpi.index.json` and loads resources directly from the local package directories managed by `fhir-package-installer`.

---

## License
MIT  
© Outburn Ltd. 2022–2025. All Rights Reserved.

---

## Disclaimer
This project is part of the [FUME](https://github.com/Outburn-IL/fume-community) open-source initiative and intended for use in FHIR tooling and development environments.
