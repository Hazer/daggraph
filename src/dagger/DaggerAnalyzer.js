import '@babel/polyfill';
// Files
import { FileSniffer } from 'filesniffer';
import FileHound from 'filehound';
import FS from 'fs';
// Models
import DModule from './models/DModule';
import DComponent from './models/DComponent.js';

/**
 * Find and load the dagger components and modules
 * @param {*Path of the android project} projectRootPath 
 */
export async function findComponents(projectRootPath){
  console.log('Analyzing dagger components and modules..');

  const files = await FileHound
    .create()
    .paths(projectRootPath)
    // We can't specify build/* because it will clash with the travis build folder 
    .discard("build/generated", "build/tmp", "build/intermediates", "build/kotlin", "build/outputs", "build/reports") 
    .depth(20)
    .ignoreHiddenDirectories()
    .ignoreHiddenFiles()
    .ext('.java', '.kt')
    .find();

  return searchModules(files).then(modules => searchComponents(modules, files));
}

function searchModules(files){
    return new Promise((resolve, reject) => {
      const daggerModules = [];
      const analyzed = []; 
      const fileSniffer = FileSniffer.create().paths(files);
  
      fileSniffer.on("match", (path) => {
        if (analyzed.includes(path)) return;
        analyzed.push(path);

        var module = new DModule();
        module.init(path);
        daggerModules.push(module);
      });
      fileSniffer.on("end", (files) => {
        resolve(findAndAddInjections(daggerModules, files));
      });
      fileSniffer.on("error", (e) => {
        reject("Error while searching for modules "+e);
      });
      fileSniffer.find("@Module");
    });
  }
  
  function searchComponents(modules, files){
    return new Promise((resolve, reject) => {

      const daggerComponents = [];
      const analyzed = []; 
      const fileSniffer = FileSniffer.create().paths(files);
  
      fileSniffer.on('match', (path) => {
        if (analyzed.includes(path)) return;
        analyzed.push(path);

        const component = new DComponent();
        component.init(path, modules);
        daggerComponents.push(component);
      });
      fileSniffer.on("end", (files) => {
        resolve(daggerComponents);
      });
      fileSniffer.on("error", (e) => {
        reject("Error while searching for components " + e);
      });
      fileSniffer.find(/@(?:dagger\.)?(?:Component|Subcomponent)/);
    });
  }

  function findAndAddInjections(modules, files){
    return new Promise((resolve, reject) => {
        const injectionPathMap = [];

        // Find all the field injections for kotline and java (group 1 java only, group 2 kotlin only) 
        const injectRegex = /(?:(?:@Inject(?:\n|.)*?\s+(?:protected|public|lateinit|(\w+(?:\.\w+)*))?\s+(?:var(?:\n|.)*?:\s*)?)|(?:@field\s*:\s*\[(?:\n|.)*?Inject(?:\n|.)*?\]\s*(?:protected|public|lateinit)?\s*var\s*.+?\s*:\s*))(\w+(?:\.\w+)*)/g;
        const namedRegex = /@*Named\(\"(\w*)\"\)/;
        const fileSniffer = FileSniffer.create().paths(files);

        fileSniffer.on('match', (path) => {
          // Open file
          const file = FS.readFileSync(path, 'utf8');
          // Find injections
          let fullMatch;
          while ((fullMatch = injectRegex.exec(file)) !== null) {
            var depName;
            var depIdentifier;

            // Name Could be at 1 or 3
            if (fullMatch[1] !== undefined && fullMatch[1] !== null) depName = fullMatch[1];
            else depName = fullMatch[2];

            // Look for @Named in the full matcher and add it to the dep identifier
            const namedMatch = namedRegex.exec(fullMatch[0]);
            if(namedMatch !== null){
              depIdentifier = createDependencyIdentifier(depName, namedMatch[1]);
            }else{
              depIdentifier = depName;
            }

            // If the array of paths for that dep is not initialised, init
            if (injectionPathMap[depIdentifier] === undefined) injectionPathMap[depIdentifier] = [];

            // If the path is not already in the list, add it
            if (!injectionPathMap[depIdentifier].includes(path)){
              injectionPathMap[depIdentifier].push(path);
            }
          }
        });
        fileSniffer.on("end", (files) => {
          addInjectionsToModules(injectionPathMap, modules);
          resolve(modules);
        });
        fileSniffer.on("error", (e) => {
          reject("Error while searching for injections " + e);
        });
        fileSniffer.find(/@Inject/i);

    });
  }

  function addInjectionsToModules(injectionPathMap, modules){
    modules.forEach(module => {
      module.dependencies.forEach(dep => {
        // Define the identifier base on the name and the named parameter if present
        var depIndentifier = createDependencyIdentifier(dep.name, dep.named);
        
        // If i have some injections for that dependency in the map, add them
        if(injectionPathMap[depIndentifier] !== undefined){
          injectionPathMap[depIndentifier].forEach(path => {
            dep.addInjectionPath(path);
          });
        }
      });
    });
  }

  function createDependencyIdentifier(depName, depNamed){
    var depIndentifier = depName;
    if (depNamed !== undefined && depNamed !== null) depIndentifier = depIndentifier + "**" + depNamed;
    return depIndentifier;
  }
