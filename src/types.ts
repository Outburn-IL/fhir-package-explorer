import { FileInPackageIndex } from 'fhir-package-installer';
import type { Logger, FhirPackageIdentifier } from '@outburn/types';

export interface FileIndexEntryWithPkg extends FileInPackageIndex {
  __packageId: string;
  __packageVersion?: string;
}

export interface ExplorerConfig {
  logger?: Logger;
  registryUrl?: string;
  registryToken?: string;
  cachePath?: string;
  context: Array<string | FhirPackageIdentifier>;
  skipExamples?: boolean;
}

export interface LookupFilter extends Partial<FileInPackageIndex> {
  package?: string | FhirPackageIdentifier;
}