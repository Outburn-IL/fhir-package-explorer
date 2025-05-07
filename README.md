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
- `registryUrl`, `cachePath`, `skipExamples` — optional. Passed through to [`fhir-package-installer`](https://www.npmjs.com/package/fhir-package-installer).

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
- Multiple matches found **unless** they differ only by SemVer-compatible version

---

### `resolveMeta(filter: LookupFilter): Promise<FileInPackageIndex>`

Same as `resolve`, but returns metadata only.

---

### `getLogger(): ILogger`

Returns the internal logger used by this instance.

---

### `getCachePath(): string`

Returns the resolved cache directory used for storing FHIR packages.

---

### `getContextPackages(): Promise<{ id, version }[]>`

Returns the sorted, de-duplicated, dependency-resolved list of FHIR packages in context.

---

### `expandPackageDependencies(string | { id, version }): Promise<{ id, version }[]>`

Expands a package into the full list of related packages. The returned array includes the requested package itself and all transitive dependencies, and is de-duplicated and sorted.

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
