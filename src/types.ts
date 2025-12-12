import { FileInPackageIndex } from 'fhir-package-installer';
import type { Logger as ILogger, FhirPackageIdentifier as PackageIdentifier  } from '@outburn/types';

export interface FileIndexEntryWithPkg extends FileInPackageIndex {
  __packageId: string;
  __packageVersion?: string;
}

export interface ExplorerConfig {
  logger?: ILogger;
  registryUrl?: string;
  registryToken?: string;
  cachePath?: string;
  context: Array<string | PackageIdentifier>;
  skipExamples?: boolean;
}

export interface LookupFilter extends Partial<FileInPackageIndex> {
  package?: string | PackageIdentifier;
}