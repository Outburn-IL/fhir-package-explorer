import { FileInPackageIndex, ILogger, PackageIdentifier } from 'fhir-package-installer';

export interface FileIndexEntryWithPkg extends FileInPackageIndex {
  __packageId: string;
  __packageVersion: string;
}

export interface ExplorerConfig {
  logger?: ILogger;
  registryUrl?: string;
  cachePath?: string;
  context: Array<string | PackageIdentifier>;
  skipExamples?: boolean;
}

export interface LookupFilter extends Partial<FileInPackageIndex> {
  package?: string | PackageIdentifier;
}