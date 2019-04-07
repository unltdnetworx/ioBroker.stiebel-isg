/**
 *
 * stiebel-eltron/tecalor isg adapter
 *
 */

'use strict';

const utils = require('@iobroker/adapter-core');
const querystring = require("querystring");
let systemLanguage;
let nameTranslation;
let isgIntervall;
let isgCommandIntervall;
var jar;
let host;
let commandPaths = ["/?s=0","/?s=4,0,0","/?s=4,0,1","/?s=4,0,2","/?s=4,0,3","/?s=4,0,4","/?s=4,0,5","/?s=4,1,0","/?s=4,1,1","/?s=4,2,0","/?s=4,2,1","/?s=4,2,2","/?s=4,2,4","/?s=4,2,6","/?s=4,2,3","/?s=4,2,5","/?s=4,2,7","/?s=4,3","/?s=4,3,0","/?s=4,3,1","/?s=4,3,2","/?s=4,3,3","/?s=4,3,4"];
const valuePaths = ["/?s=1,0","/?s=1,1","/?s=2,3"];
const statusPaths = ["/?s=2,0", "/?s=1,0"];

const request = require('request');
const cheerio = require('cheerio');

let adapter;
function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: 'stiebel-isg',
        stateChange: function (id, state) {
            let command = id.split('.').pop();
            
            // you can use the ack flag to detect if it is status (true) or command (false)
            if (!state || state.ack) return;

            if (command == 'ISGReboot') {
                adapter.log.info('ISG rebooting');
                rebootISG();
                //wait 1 minute for hardware-reboot
                setTimeout(main, 60000);
            }

            setIsgCommands(command,state.val);
        },
        ready: function () {    
            adapter.getForeignObject('system.config', function (err, obj) {
                if (err) {
                    adapter.log.error(err);
                    return;
                } else if (obj) {
                    if (!obj.common.language) {
                        adapter.log.info("Language not set. English set therefore.");
                        nameTranslation = require(__dirname + '/admin/i18n/de/translations.json')
                    } else {
                        systemLanguage = obj.common.language;
                        nameTranslation = require(__dirname + '/admin/i18n/' + systemLanguage + '/translations.json')
                    }
        
                    setJar(request.jar());
                    main();
                }
            });

            if(adapter.config.isgExpert === true) {
                commandPaths.push("/?s=4,9,0","/?s=4,9,1","/?s=4,9,2","/?s=4,9,3","/?s=4,9,4","/?s=4,9,5","/?s=4,7","/?s=4,7,1","/?s=4,7,2","/?s=4,7,3","/?s=4,7,4","/?s=4,7,5","/?s=4,7,6","/?s=4,7,7","/?s=4,7,8")
            }
        },
        unload: function (callback) {
            try {
                if (isgIntervall) clearInterval(isgIntervall);
                if (isgCommandIntervall) clearInterval(isgCommandIntervall);
                adapter.log.info('cleaned everything up...');
                callback();
            } catch (e) {
                callback();
            }
        }
    });
    adapter = new utils.Adapter(options);
    
    return adapter;
};


function setJar(jarParam) {
    jar = jarParam;
}

function getJar() {
    if(jar)
        return jar;
    else {
        jar = request.jar();
        return jar;
    }
}

function translateName(strName, intType) {
    if (typeof intType === 'undefined') { intType = 0; }
    
    switch (intType) {
        case 1:
            if(nameTranslation[strName]) {
                return nameTranslation[strName][1];
            } else {
                return strName;
            }
            break;
        case 0:
        default:
            if(nameTranslation[strName]) {
                return nameTranslation[strName][0];
            } else {
                return strName;
            }
            break;
    }
}

function updateState (strGroup,valTag,valTagLang,valType,valUnit,valRole,valValue) {
    
    let ValueExpire = null;

    if(strGroup.startsWith(translateName("settings"))){
        ValueExpire = (adapter.config.isgCommandIntervall*2);
    } else {
        ValueExpire = (adapter.config.isgIntervall*2);
    }
    
    if(adapter.config.isgUmlauts == "no"){
        valTag = valTag
            .replace(/[\u00c4]+/g,"AE")           
            .replace(/[\u00d6]+/g,"OE")
            .replace(/[\u00dc]+/g,"UE");
        strGroup = strGroup
            .replace(/[\u00c4]+/g,"AE")           
            .replace(/[\u00d6]+/g,"OE")
            .replace(/[\u00dc]+/g,"UE");
    }
    
    adapter.log.debug("strGroup: "+strGroup);
    adapter.setObjectNotExists(
        strGroup + "." + valTag, {
            type: 'state',
            common: {
                name: valTagLang,
                type: valType,
                read: true,
                write: false,
                unit: valUnit,
                role: valRole
            },
            native: {}
        },
        adapter.setState(
            strGroup + "." + valTag,
            {val: valValue, ack: true, expire: ValueExpire} //value expires if adapter can't pull it from hardware
        )
    );
}

function getIsgStatus(sidePath) {
    let strURL = host + sidePath;
    
    const payload = querystring.stringify({
        user: adapter.config.isgUser,
        pass: adapter.config.isgPassword
    });
    
    const options = {
        method: 'POST',
        body: payload,
        uri: strURL,
        jar: getJar(),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Connection': 'keep-alive'
        }
    };
    
    request(options, function (error, response, content) {
        if (!error && response.statusCode == 200) {
            let $ = cheerio.load(content);
            
            let submenu = $('#sub_nav')
                .children()
                .first()
                .text()
                .replace(/[\-\/]+/g,"_")
                .replace(/[ \.]+/g,"")
                .replace(/[\u00df]+/g,"SS");

            $('.info').each((i, el) => {                
                let group = $(el)
                    .find(".round-top")    
                    .text()
                    .replace(/[ \-]+/g,"_")
                    .replace(/[\.]+/g,"")
                    .replace(/[\u00df]+/,"SS");
                
                group = submenu + "." + group
                
                $(el).find('tr').each(function() {
                    let valueName = $(this)
                        .find(".key")
                        .text();
                    
                    let key = $(this)
                        .find(".key")
                        .text()
                        .replace(/[ \-]+/g,"_")
                        .replace(/[\.]+/g,"")
                        .replace(/[\u00df]+/,"SS");

                    //<img src="./pics/tec-symbol_an-8e8e8e.png" height="15">                   
                    let param = $(this)
                        .find(".value")
                        .html();
                    
                    let value;

                    if(param !== null){
                        if (param.search('symbol_an') > -1){
                            value = true;
                        }
                    }
                    
                    let valType = typeof value;
                    let valueRole;
                    
                    if(value === true){
                        //adapter.log.error(value);
                        updateState (translateName("info") + "." + group,key,translateName(valueName),"state","","indicator.state",value);
                    }
                }); 
            })
        } else {
            adapter.log.error(error);
        }
    });
}

function getIsgValues(sidePath) {
    let strURL = host + sidePath;
    
    const payload = querystring.stringify({
        user: adapter.config.isgUser,
        pass: adapter.config.isgPassword
    });
    
    const options = {
        method: 'POST',
        body: payload,
        uri: strURL,
        jar: getJar(),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Connection': 'keep-alive'
        }
    };
    
    request(options, function (error, response, content) {
        if (!error && response.statusCode == 200) {
            let $ = cheerio.load(content);
            
            let submenu = $('#sub_nav')
                .children()
                .first()
                .text()
                .replace(/[\-\/]+/g,"_")
                .replace(/[ \.]+/g,"")
                .replace(/[\u00df]+/g,"SS");

            $('.info').each((i, el) => {                
                let group = $(el)
                    .find(".round-top")    
                    .text()
                    .replace(/[ \-]+/g,"_")
                    .replace(/[\.]+/g,"")
                    .replace(/[\u00df]+/,"SS");
                
                group = submenu + "." + group
                
                $(el).find('tr').each(function() {
                    let valueName = $(this)
                        .find(".key")
                        .text();
                    
                    let key = $(this)
                        .find(".key")
                        .text()
                        .replace(/[ \-]+/g,"_")
                        .replace(/[\.]+/g,"")
                        .replace(/[\u00df]+/,"SS");
                    
                    let param = $(this)
                        .find(".value")
                        .text()
                        .replace(/\,/,".");
                    
                    let value = parseFloat(param);
                    let unit = param
                        .replace(/[ ]{0,2}/, "")
                        .replace(/ /g,"")
                        .replace(value, "")
                        .replace(/([\.0][0]){1}?/, "");
                    
                    let valType = typeof value;
                    let valueRole;
                    
                    if (key.search('TEMP') > -1 || key.search('SOLLWERT_HK') == 0 || key.search('ISTWERT_HK') == 0){
                        valueRole = 'value.temperature';
                    } else if (key.search('DRUCK') > -1){
                        valueRole = 'value.pressure';
                    } else if (key.search('P_') == 0){
                        valueRole = 'value.power.consumption';
                    } else if (key.search('FEUCHTE') > -1){
                        valueRole = 'value.humidity';
                    } else {
                        valueRole = 'value';
                    }

                    if(key && value != null){
                        updateState (translateName("info") + "." + group,key,translateName(valueName),valType,unit,valueRole,value);
                    }
                }); 
            })
        } else {
            adapter.log.error(error);
        }
    });
}

function createISGCommands (strGroup,valTag,valTagLang,valType,valUnit,valRole,valValue,valStates,valMin,valMax) {
    if(adapter.config.isgUmlauts == "no"){
        valTag = valTag
            .replace(/[\u00c4]+/g,"AE")           
            .replace(/[\u00d6]+/g,"OE")
            .replace(/[\u00dc]+/g,"UE");
        strGroup = strGroup
            .replace(/[\u00c4]+/g,"AE")           
            .replace(/[\u00d6]+/g,"OE")
            .replace(/[\u00dc]+/g,"UE");
    }
    
    valUnit = valUnit.replace(/ /g,"");

    adapter.log.debug("strGroup: "+strGroup);
    adapter.setObjectNotExists(
        strGroup + "." + valTag, {
            type: 'state',
            common: {
                name: valTagLang,
                type: valType,
                read: true,
                write: true,
                unit: valUnit,
                role: valRole,
                min: valMin,
                max: valMax,
                states: valStates
            },
            native: {}
        },
        adapter.setState(
            strGroup + "." + valTag,
            {val: valValue, ack: true}
        )
    );
}

function getIsgCommands(sidePath) {
    let strURL = host + sidePath;
    
    const payload = querystring.stringify({
        user: adapter.config.isgUser,
        pass: adapter.config.isgPassword
    });
    
    const options = {
        method: 'POST',
        body: payload,
        uri: strURL,
        jar: getJar(),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Connection': 'keep-alive'
        }
    };
    
    request(options, function (error, response, content) {
        if (!error && response.statusCode == 200) {
            let $ = cheerio.load(content);
            
            let group = $('#sub_nav')
                .children()
                .first()
                .text()
                .replace(/[\-\/]+/g,"_")
                .replace(/[ \.]+/g,"")
                .replace(/[\u00df]+/g,"SS");

            let submenu = $.html().match(/#subnavactivename"\).html\('(.*?)'/);
            let submenupath = "";
            
            //Get values from script, because JavaScript isn't running with cheerio.
            $('#werte').find("input").each(function(i, el) {
                if(sidePath == "/?s=0"){
                    let nameCommand;
                    let valCommand;
                    let idCommand;
                    let statesCommand;
                    nameCommand = $(el).parent().parent().find('h3').text();
                    if(nameCommand == "Betriebsart"){                  
                        let idStartCommand = $(el).attr('name');
                        if(idStartCommand.match(/aval/)) {
                            $(el).parent().parent().parent().parent().find('div.values').each(function(j, ele){
                                statesCommand = '{';
                                $(ele).find('input').each(function(k,elem){
                                    idCommand = $(elem).attr('name');
                                    if(!(idCommand.match(/aval/) || idCommand.match(/info/))) {
                                        if(idCommand.match(/[0-9]s/)){
                                            if(statesCommand !== "{"){
                                                statesCommand += ",";
                                            }
                                            statesCommand += '"' + $(elem).attr('value') + '":"' + $(elem).next().text() + '"';
                                        } else {
                                            valCommand = $(elem).attr('value');
                                        } 
                                    }
                                })  
                            })
                            statesCommand += "}";
                            createISGCommands(translateName("Start"), idCommand, nameCommand, "number","","level",valCommand,statesCommand,"","");
                        }
                    }
                } else if($(this).parent().find('div.black').html()) {
                    $(this).parent().find('div.black').each(function(j, ele){
                        let nameCommand = $(ele).parent().parent().parent().find('h3').text();
                        let idCommand = $(ele).find('input').attr('name');
                        let valCommand;

                        let statesCommand = '{'
                        $(ele).find('input').each(function(j, el){
                            if(statesCommand !== "{"){
                                statesCommand += ",";
                            }
                            statesCommand += '"' + $(el).attr('value') + '":"' + $(el).attr('alt') + '"';

                            if($(el).attr('checked') == 'checked'){
                                valCommand = $(el).attr('value');
                            }
                        })
                        statesCommand += "}";
                        if(submenu){
                            submenupath = "";
                            submenupath += "." + submenu[1];
                        }
                        createISGCommands(translateName("settings") + "." + group + submenupath, idCommand, nameCommand, "number","","level",valCommand,statesCommand,"","");
                    })
                } else {
                    let parentsClass = $(el)
                        .parent()
                        .attr('class');
                    
                    let scriptValues;
                    
                    if (parentsClass == "current"){
                        $(el).parent().parent().find('div.black').each(function(j, ele){
                            let nameCommand = $(ele).parent().parent().parent().parent().find('h3').text();
                            let idCommand = $(ele).parent().find('input').attr('id');
                            let valCommand;
    
                            $(ele).parent().find('input').each(function(j, el){
                                if($(el).attr('checked') == 'checked'){
                                    valCommand = $(el).attr('value');
                                }
                            })
                            if(submenu){
                                submenupath = "";
                                submenupath += "." + submenu[1];
                            }
                            updateState(translateName("settings") + "." + group + submenupath, idCommand, translateName(nameCommand), "number", "","level",valCommand);
                        })
                    } else {
                        //ignore hidden fields (chval*)
                        let parentsID = $(el).parent().attr('id');
                        
                        if(parentsID === undefined) {
                            parentsID = "";
                        }

                        if (!(parentsID.includes('chval'))) {
                            scriptValues = $(el)
                                .next()
                                .get()[0]
                                .children[0]
                                .data;
                            
                            if(scriptValues){
                                let nameCommand = $(el).parent().parent().find('h3').text();
                                
                                let minCommand = scriptValues.match(/\['min'] = '(.*?)'/);
                                let maxCommand = scriptValues.match(/\['max'] = '(.*?)'/);
                                let valCommand = scriptValues.match(/\['val']='(.*?)'/);
                                let idCommand = scriptValues.match(/\['id']='(.*?)'/);
                                let unitCommand = $(el).parent().parent().find('.append-1').text();
                                
                                if(idCommand){
                                    if(submenu){
                                        submenupath = "";
                                        submenupath += "." + submenu[1];
                                    }
                                    createISGCommands(translateName("settings") + "." + group + submenupath, idCommand[1], nameCommand, "number",unitCommand,"state",valCommand[1],"",minCommand[1],maxCommand[1]);
                                }
                            }
                        } 
                    }
                }
            })
            //"Info_alone" Felder
            $('#werte').find('.info_alone').each(function(i, el) {
                let valValue = $(el).text();
                let nameCommand = $(el).parent().parent().find('h3').text();
                let idCommand = $(el).parent().parent().attr('id');
                let unitCommand = $(el).parent().parent().find('.append-1').text();
                
                if(valValue){
                    if(submenu){
                        submenupath = "";
                        submenupath += "." + submenu[1];
                    }
                    updateState(translateName("settings") + "." + group + submenupath, idCommand, translateName(nameCommand), "number",unitCommand,"state",valValue);
                }
            })
        } else {
            adapter.log.error(error);
        }
    });
}

function setIsgCommands(strKey, strValue) {    
    const commands = JSON.stringify(
        [{'name': strKey,
          'value': strValue}]
    )
    
    const payload = querystring.stringify({
        user: adapter.config.isgUser,
        pass: adapter.config.isgPassword,
        data: commands
    });

    const postOptions = {
        method: 'POST',
        uri: host + "/save.php",
        port: '80',
        body: payload,
        jar: getJar(),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': '*/*'
        }
    };

    //renew all settings after waitingtime of 10 Seconds. If more commands are sent.
    var timeoutHandle = setTimeout(function(){
        request(postOptions, function (error, response, content) {
            if (!error && response.statusCode == 200) {
                commandPaths.forEach(function(item){
                    getIsgCommands(item);
                })
            } else {
                adapter.log.error(error);
            }
        });
    },10000);
    
    clearTimeout(timeoutHandle);
    timeoutHandle;
}

function main() {
    adapter.setObjectNotExists(
        "ISGReboot", {
            type: 'state',
            common: {
                name: translateName("ISGReboot"),
                type: 'boolean',
                role: 'button',
                read: true,
                write: true
            },
            native: {}
        },
        adapter.subscribeStates('ISGReboot')
    );
    
    host = adapter.config.isgAddress;
    if(host.search(/http/i) == -1){
        host = "http://" + host;
    }
    adapter.subscribeStates('*')
    
    statusPaths.forEach(function(item){
        getIsgStatus(item);
    })

    valuePaths.forEach(function(item){
        getIsgValues(item);
    })

    commandPaths.forEach(function(item){
        getIsgCommands(item);
    })

    isgIntervall = setInterval(function(){
            valuePaths.forEach(function(item){
                getIsgValues(item);
            }), statusPaths.forEach(function(item){
                getIsgStatus(item);
            })
        }, (adapter.config.isgIntervall * 1000));

    

    isgCommandIntervall = setInterval(function(){
            commandPaths.forEach(function(item){
                getIsgCommands(item);
            })
        }, (adapter.config.isgCommandIntervall * 1000));
}

function rebootISG(){
    request("http://" + host + "/reboot.php", { json: true }, (err, res, body) => {
        if (err) { return console.log(err); }
    });
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
