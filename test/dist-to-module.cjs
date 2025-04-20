/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs-extra');
const path = require('path');

module.exports = function () {
  const targetDir = path.resolve('node_modules', 'fhir-package-explorer');
  const distSrc = path.resolve('dist');
  const distDest = path.join(targetDir, 'dist');
  const filesToCopy = ['README.md', 'LICENSE', 'package.json'];

  console.log(`Creating ${targetDir}...`);
  fs.ensureDirSync(targetDir);

  console.log(`Copying assets from ${distSrc} to ${distDest}...`);
  fs.copySync(distSrc, distDest);

  filesToCopy.forEach(file => {
    const src = path.resolve(file);
    const dest = path.join(targetDir, path.basename(file));
    console.log(`Copying ${src} to ${dest}...`);
    fs.copyFileSync(src, dest);
  });

  console.log('✅ Done.');
};
