
import {promisified as regedit} from "regedit";
import util from "util";
import child_process from "child_process";
import { fileURLToPath } from 'url';
import fs from 'fs';
import regman from './modules/regman.js';
import path, { parse } from 'path';
import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import * as si from "systeminformation";

let execAsync = util.promisify(child_process.exec);


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let time = new Date().getTime().valueOf();

// get the drive letter from yargs
let d = yargs(hideBin(process.argv))
.command("list", "List Drives with Windows Installations", async (argv) => {
        // find all windows drives
        let windowsDrives = await findWindowsDrives();
        for(let {letter, version = "", displayVersion, error} of windowsDrives) {
            if(error) {
                console.log(`${letter} - Error: Could Not Read Windows`);
                continue;
            }
            console.log(`${letter} - Windows ${displayVersion} (${version})`);
        }
    }
)
.command("services <drive>", "List Services On A Drive", async (yargs) => {
    // find all windows drives
    let driveLetter = yargs.argv._[1];
    if(!driveLetter) {
        console.log("Please provide a drive letter");
        return;
    }
    listServices(driveLetter);
})
.command("set <drive> <service> <value>", "Set Service Start Type", async (yargs) => {
    let [arg, driveLetter, service, value] = yargs.argv._;
    if(!driveLetter) {
        console.log("Please provide a drive letter");
        return;
    }
    if(!service) {
        console.log("Please provide a service name");
        return;
    }
    if(!value) {
        console.log("Please provide a value");
        return;
    }

    await setServiceStartType(driveLetter, service, value);
})
.argv;


async function findWindowsDrives(){
    let drives = await si.blockDevices();
    let letters = drives.filter(drive => drive.fsType === "ntfs").map(drive => drive.name.replace(":", ""));
    let windowsDrives = [];
    console.log("Searching For Windows Drives...");
    for (let letter of letters) {
        let drive = { letter };
        // check for the windows folder
        let windowsFolder = `${letter}://Windows`;
        let exists = await fs.promises.access(windowsFolder).then(() => true).catch(() => false);
        if (!exists) continue;

        // get system version
        let {stderr} =  await execAsync(`reg load HKLM\\temp_${letter}_SOFTWARE ${letter}:\\Windows\\System32\\config\\SOFTWARE`)
        .catch((err) => {
            // console.log(`${letter} - Error: ${err}`);
            return {stderr: err};
        });

        // now check the windows version by reading the registry
        if(stderr) {
            windowsDrives.push({letter, error: true});
            await execAsync(`reg unload HKLM\\temp_${letter}_SOFTWARE`).catch((err) => {});
            continue;
        }
        let d = await regedit.list(`HKLM\\temp_${letter}_SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion`);

        drive.version = d["HKLM\\temp_"+letter+"_SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"]?.values?.CurrentBuild?.value || "";
        drive.displayVersion = d["HKLM\\temp_"+letter+"_SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"]?.values?.DisplayVersion?.value || "";
        windowsDrives.push({...drive});
        await execAsync(`reg unload HKLM\\temp_${letter}_SOFTWARE`);
    }
    return windowsDrives;
}

function setup(){
    // create a new temp directory
    fs.mkdirSync(path.join(__dirname, "temp"), {recursive: true});
}




async function listServices(driveLetter){
    driveLetter = driveLetter.toUpperCase().replace(":", "");
    // backup the registry


    // check for the drive
    let drives = await findWindowsDrives();
    let drive = drives.find(d => d.letter === driveLetter);
    if(!drive) {
        console.error(`Drive ${driveLetter} Not Found`);
        return;
    }

    let _root = `HKLM\\temp_${driveLetter}_SYSTEM`;
    let _path = `${_root}\\ControlSet001\\Services`;
    console.log(`Found Windows ${drive.displayVersion} (${drive.version}) on ${driveLetter}`);
    console.log("Mounting Registry Hive " + _root + "...");
    // mount the registry hive
    await execAsync(`reg load ${_root} ${driveLetter}:\\Windows\\System32\\config\\SYSTEM`)
    .catch((err) => {
        console.error(`ERROR: ${err}`);
        return process.exit(1);
    });

    console.log("Backing Up Registry...");
    //backup the registry
    await execAsync(`reg export ${_path} ${path.join(__dirname, "temp", `ControlSet_${driveLetter}_${time}.reg`)} /y`)
    .catch((err) => {
        console.error(`ERROR: ${err}`);
        return process.exit(1);
    });
    
    console.log("Reading Registry Back Up...");
    // read the backup of the registry
    let reg = await regman.parseRegFile(path.join(__dirname, "temp", `ControlSet_${driveLetter}_${time}.reg`));

    let services = Object.keys(reg).filter(key => reg[key]?.Start).map(key => key.replace(/HKEY_LOCAL_MACHINE\\temp_[A-Z]_SYSTEM\\ControlSet001\\Services\\/g, ""));

    let table = []
    for(let service of services){
        let start = reg[`HKEY_LOCAL_MACHINE\\temp_${driveLetter}_SYSTEM\\ControlSet001\\Services\\${service}`]?.Start?.value;
        let displayName = reg[`HKEY_LOCAL_MACHINE\\temp_${driveLetter}_SYSTEM\\ControlSet001\\Services\\${service}`]?.DisplayName?.value;        
        start = start || "9";
        start = parseInt(start).toString();

        switch(start){
            case "0":
                start += " Boot";
                break;
            case "1":
                start += " System";
                break;
            case "2":
                start += " Auto";
                break;
            case "3":
                start += " Manual";
                break;
            case "4":
                start += " Disabled";
                break;
            default:
                start += " Unknown";
        }

        displayName = displayName || "";


        table.push([start, service, displayName]);
    }

    // now create a padded table
    let maxServiceLength = Math.max(...services.map(service => service.length));
    let maxDisplayNameLength = Math.max(...table.map(row => row[2]?.length || 0));
    let maxStartLength = Math.max(...table.map(row => row[0].toString().length));
    let paddedTable = table.map(row => {
        return [
            row[0].padEnd(maxStartLength),
            row[1].toString().padEnd(maxServiceLength),
            row[2]
       
        ];
    });

    console.log("Services:");
    for(let row of paddedTable){
        let line = row.join(" | ");
        // set a max line length of 80 characters so we may need to truncate display name and only show the last of display name
        if(line.length > 80){
            let [start, service, displayName] = row;
            let displayNameLength = displayName.length;
            let startLength = start.length;
            let serviceLength = service.length;
            let maxDisplayNameLength = 80 - startLength - serviceLength - 3;
            displayName = displayName.substring(displayNameLength - maxDisplayNameLength);
            line = [start, service, displayName].join(" | ");

        }
        console.log(line);
        
    }
}


async function setServiceStartType(driveLetter, service, value){
    driveLetter = driveLetter.toUpperCase().replace(":", "");
    // check for the drive
    let drives = await findWindowsDrives();
    let drive = drives.find(d => d.letter === driveLetter);
    if(!drive) {
        console.error(`Drive ${driveLetter} Not Found`);
        return;
    }

    let _root = `HKLM\\temp_${driveLetter}_SYSTEM`;
    let _path = `${_root}\\ControlSet001\\Services`;
    console.log(`Found Windows ${drive.displayVersion} (${drive.version}) on ${driveLetter}`);
    console.log("Mounting Registry Hive " + _root + "...");
    // mount the registry hive
    await execAsync(`reg load ${_root} ${driveLetter}:\\Windows\\System32\\config\\SYSTEM`)
    .catch((err) => {
        console.error(`ERROR: ${err}`);
        return process.exit(1);
    });

    console.log("Backing Up Registry...");
    //backup the registry
    await execAsync(`reg export ${_path} ${path.join(__dirname, "temp", `ControlSet_${driveLetter}_${time}.reg`)} /y`)
    .catch((err) => {
        console.error(`ERROR: ${err}`);
        return process.exit(1);
    });
    
    console.log("Reading Registry Back Up...");
    // read the backup of the registry
    let reg = await regman.parseRegFile(path.join(__dirname, "temp", `ControlSet_${driveLetter}_${time}.reg`));

    let services = Object.keys(reg).filter(key => reg[key]?.Start).map(key => key.replace(/HKEY_LOCAL_MACHINE\\temp_[A-Z]_SYSTEM\\ControlSet001\\Services\\/g, ""));

    //check if the service exists
    if(!services.includes(service)){
        console.error(`Service ${service} Not Found`);
        return;
    }

    value = value.toString();
    // check if the value is valid
    let startTypes = ["0", "1", "2", "3", "4"];
    if(!startTypes.includes(value)){
        console.error(`Invalid Startup Value ${value}`);
        return;
    }

    console.log(`Setting ${service} Start Type to ${value}...`);
    let key = `HKLM\\temp_${driveLetter}_SYSTEM\\ControlSet001\\Services\\${service}`;
    await regedit.putValue({
        [key]: {
            Start: {
                value: value,
                type: "REG_DWORD"
            }
        }
    }, (err) => {
        if(err) {
            console.error(err);
            process.exit(1);
        }
    });
}

setup();
