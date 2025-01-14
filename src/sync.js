/* Duino-Coin Pool Sync handler
For documention about these functions see
https://github.com/revoxhere/duino-coin/blob/useful-tools
2019-2021 Duino-Coin community */

const net = require("net");
const axios = require("axios");
const fs = require("fs");
const osu = require("node-os-utils");

const {
    poolID,
    poolVersion,
    serverIP,
    serverPort,
    port,
    base_sync_folder,
    syncTime,
    timeout
} = require("../config/config.json");
let ip, sync_count = 0;
const SYNC_TIME = syncTime * 1000;
const TIMEOUT = timeout * 1000;

async function login() {
    const res = await axios.get("https://api.ipify.org/");
    if (!res.data) {
        console.log(`${poolID}: ${new Date().toLocaleString()} - Can't fetch pool IP`);
        process.exit(-1);
    }
    ip = res.data;

    const loginInfos = {
        host: ip,
        port: port,
        version: poolVersion,
        identifier: poolID
    };

    const socket = new net.Socket();
    try {
        socket.setEncoding("utf-8");
        socket.setTimeout(TIMEOUT);
        socket.connect(serverPort, serverIP);
    } catch (err) {
        console.log(`${poolID}: ${new Date().toLocaleString()} - Socket error at connect: ${err}`);
    }

    socket.on("error", (err) => {
        console.log(`${poolID}: ${new Date().toLocaleString()} - Socket error at login: ${err}`);
        process.exit(-1);
    });

    socket.on("timeout", () => {
        console.log(`${poolID}: ${new Date().toLocaleString()} - Socket timeout at login`);
        process.exit(-1);
    });

    socket.on("data", (data) => {
        if (data.startsWith("2")) {
            socket.write(`PoolLogin,${JSON.stringify(loginInfos)}`);
        } else if (data === "LoginOK") {
            console.log(`${poolID}: ${new Date().toLocaleString()} - Successfully logged in`);
            socket.destroy();
            sync();
            setInterval(sync, SYNC_TIME);
        } else {
            console.log(`${poolID}: ${new Date().toLocaleString()} - Unknown error, server returned ${data} in login`);
            process.exit(-1)
        }
    })
}

function logout() {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        try {
            socket.setEncoding("utf-8");
            socket.setTimeout(TIMEOUT);
            socket.connect(serverPort, serverIP);
        } catch (err) {
            console.log(`${poolID}: ${new Date().toLocaleString()} - Socket error at connect: ${err}`);
        }

        socket.on("error", (err) => {
            console.log(`${poolID}: ${new Date().toLocaleString()} - Socket error at logout: ${err}`);
            reject(1);
        });

        socket.on("timeout", () => {
            console.log(`${poolID}: ${new Date().toLocaleString()} - Socket timeout at logout`);
            reject(1);
        });

        socket.on("data", (data) => {
            if (data.startsWith("2")) {
                socket.write(`PoolLogout,${poolID}`);
            } else if (data === "LogoutOK") {
                console.log(`${poolID}: ${new Date().toLocaleString()} - Successfully logged out`)
                resolve();
            } else {
                console.log(`${poolID}: ${new Date().toLocaleString()} - Unknown error, server returned ${data} in logout`);
                reject(data);
            }
        })
    })
}

async function sync() {
    const mining = require("./mining");
    require("./index");

    const cpuUsage = await osu.cpu.usage();
    let ramUsage = await osu.mem.info();
    ramUsage = 100 - ramUsage.freeMemPercentage;

    const blockIncrease = mining.stats.globalShares.increase;
    mining.stats.globalShares.increase = 0;

    const syncData = {
        blocks: {
            "blockIncrease": blockIncrease,
            "bigBlocks": globalBlocks
        },
        cpu: cpuUsage,
        ram: ramUsage,
        connections: connections
    }

    fs.writeFileSync(`${base_sync_folder}/workers_${poolID}.json`, JSON.stringify(mining.stats.minersStats, null, 0));
    fs.writeFileSync(`${base_sync_folder}/rewards_${poolID}.json`, JSON.stringify(mining.stats.balancesToUpdate, null, 0));
    fs.writeFileSync(`${base_sync_folder}/statistics_${poolID}.json`, JSON.stringify(syncData, null, 0));

    let request_url = `https://server.duinocoin.com/pool_sync/?host=${ip}&port=${port}&version=${poolVersion}&identifier=${poolID}&blockIncrease=${blockIncrease}&bigBlocks=${globalBlocks}&cpu=${cpuUsage}&ram=${ramUsage}&connections=${connections}`;

    try {
        sync_count += 1;
        axios.get(request_url)
        .then(response => {
            if (response) {
                if (response.data.success) {
                    Object.keys(mining.stats.balancesToUpdate).forEach(k => {
                        delete mining.stats.balancesToUpdate[k];
                    });
                    globalBlocks = [];
                    console.log(`${poolID}: ${new Date().toLocaleString()} - Successfull sync #${sync_count}`);
                } else {
                    console.log(`${poolID}: ${new Date().toLocaleString()} - Server error at sync #${sync_count}: ${response.data.message}`);
                }
            }
        })
        .catch(function (error) {
            console.log(`${poolID}: ${new Date().toLocaleString()} - Socket error at sync`);
        })
    } catch (err) {
        console.log(`${poolID}: ${new Date().toLocaleString()} - Other error at sync: ${err}`);
    }
}

function updatePoolReward() {
    axios.get('https://server.duinocoin.com/PoolRewards.json')
    .then(response => {
        fs.writeFileSync('./config/poolRewards.json', JSON.stringify(response.data, null, 0));
        console.log(`${poolID}: ${new Date().toLocaleString()} - Updated pool rewards file`)
    })
    .catch(function (error) {
        console.log(`${poolID}: Error at updating pool rewards file`);
    });

    bans = require('../config/bans.json');
    axios.get('https://server.duinocoin.com/poolsyncdata/bans.json')
    .then(response => {
        for (username in response)
            if (!bans.bannedUsernames.includes[username])
                bans.bannedUsernames.push(username);

        fs.writeFileSync('./config/bans.json', JSON.stringify(bans, null, 0));
        console.log(`${poolID}: ${new Date().toLocaleString()} - Updated bans file`);
    })
    .catch(function (error) {
        console.log(`${poolID}: ${new Date().toLocaleString()} - Error at updating bans file`);
    });

    setTimeout(updatePoolReward, 60 * 5 * 1000);
}

module.exports = {
    login,
    logout,
    updatePoolReward
};
