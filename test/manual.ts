import { FhirPackageExplorer } from '../src/index';
import path from 'path';
import fs from 'fs-extra';

console.log('===================================================');
console.log('================== test script ====================');
console.log('===================================================');
console.log('Running test script...');

const runTests = async () => {
  const explorer = await FhirPackageExplorer.create({
    context: ['hl7.fhir.uv.sdc@3.0.0'],
    cachePath: path.join('test', '.test-cache'),
  });

  const meta = await explorer.lookupMeta({ resourceType: 'ConceptMap' });
  console.log('Indexed ConceptMaps:', meta.length);
  fs.writeJSONSync(path.join('test', 'manual', 'ConceptMaps.json'), meta, { spaces: 2 });
  console.log('ConceptMaps written to test/manual/ConceptMaps.json');
  // console.log('StructureDefinitions:', meta);
};

runTests();
