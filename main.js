"use strict";

/**
 *
 * stiebel-eltron/tecalor isg adapter
 *
 */

const utils = require("@iobroker/adapter-core");
const querystring = require("querystring");
let systemLanguage;
let nameTranslation;
let isgIntervall;
let isgCommandIntervall;
let commands = [];
let CommandTimeout;
let jar;
let host;
let commandPaths = [];
let valuePaths = [];
let statusPaths = [];

const request = require("request");
const cheerio = require("cheerio");

let adapter;
function startAdapter(options) {
	options = options || {};
	Object.assign(options, {
		name: "stiebel-isg",
		stateChange: function (id, state) {
			const command = id.split(".").pop();

			// you can use the ack flag to detect if it is status (true) or command (false)
			if (!state || state.ack) return;

			if (command == "ISGReboot") {
				adapter.log.info("ISG rebooting");
				rebootISG();
				//wait 1 minute for hardware-reboot
				setTimeout(main, 60000);
			}

			setIsgCommands(command,state.val);
		},
		ready: function () {
			adapter.getForeignObject("system.config", function (err, obj) {
				if (err) {
					adapter.log.error(err);
					adapter.log.error("statusCode: " + obj.statusCode);
					adapter.log.error("statusText: " + obj.statusText);
					return;
				} else if (obj) {
					if (!obj.common.language) {
						adapter.log.info("Language not set. English set therefore.");
						nameTranslation = require(__dirname + "/admin/i18n/en/translations.json");
					} else {
						systemLanguage = obj.common.language;
						nameTranslation = require(__dirname + "/admin/i18n/" + systemLanguage + "/translations.json");
					}

					setJar(request.jar());
					main();
				}
			});

			commandPaths = adapter.config.isgCommandPaths.split(";");
			valuePaths= adapter.config.isgValuePaths.split(";");
			statusPaths = adapter.config.isgStatusPaths.split(";");

			if(adapter.config.isgExpert === true) {
				commandPaths.push(adapter.config.isgExpertPaths.split(";"));
			}
		},
		unload: function (callback) {
			try {
				if (isgIntervall) clearInterval(isgIntervall);
				if (isgCommandIntervall) clearInterval(isgCommandIntervall);
				adapter.log.info("cleaned everything up...");
				callback();
			} catch (e) {
				callback();
			}
		}
	});
	adapter = new utils.Adapter(options);

	return adapter;
}


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
	if (typeof intType === "undefined") { intType = 0; }

	switch (intType) {
		case 1:
			if(nameTranslation[strName]) {
				return nameTranslation[strName][1];
			} else {
				return strName;
			}
		case 0:
		default:
			if(nameTranslation[strName]) {
				return nameTranslation[strName][0];
			} else {
				return strName;
			}
	}
}

function updateState (strGroup,valTag,valTagLang,valType,valUnit,valRole,valValue) {

	let ValueExpire = null;

	if(strGroup.startsWith(translateName("settings")) || strGroup.startsWith(translateName("info") + ".ANLAGE.STATISTIK")){
		ValueExpire = (adapter.config.isgCommandIntervall*2);
	} else {
		ValueExpire = (adapter.config.isgIntervall*2);
	}

	if(adapter.config.isgUmlauts == "no"){
		valTag = Umlauts(valTag);
		strGroup = Umlauts(strGroup);
	}

	valTag = valTag.replace(/[*]+/g,"_");

	const splitPath = strGroup.split(".");
	const endPaths = [splitPath[0]];
	for(let i = 1; i <= splitPath.length-1; i++){
		endPaths.push(endPaths[i-1] + "." + splitPath[i]);
	}
	endPaths.forEach(element => adapter.setObjectNotExists(
		element, {
			type: "channel"
		},
	));

	adapter.setObjectNotExists(
		strGroup + "." + valTag, {
			type: "state",
			common: {
				name: valTagLang,
				type: valType,
				read: true,
				write: false,
				unit: valUnit,
				role: valRole
			},
			native: {}
		}, function() {
			adapter.setState(
				strGroup + "." + valTag,
				{val: valValue, ack: true, expire: ValueExpire} //value expires if adapter can't pull it from hardware
			);
		});
}

function getHTML(sidePath) {
	const strURL = host + "/?s=" + sidePath;

	const payload = querystring.stringify({
		user: adapter.config.isgUser,
		pass: adapter.config.isgPassword
	});

	const options = {
		method: "POST",
		body: payload,
		uri: strURL,
		jar: getJar(),
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"Connection": "keep-alive"
		}
	};

	return new Promise(function (resolve, reject) {
		request(options, function (error, response, content) {
			if (!error && response.statusCode == 200) {
				resolve(cheerio.load(content));
			} else if (error) {
				adapter.log.error("Error: " + error);
				reject(error);
			} else if (response.statusCode !== 200) {
				adapter.log.error("statusCode: " + response.statusCode);
				adapter.log.error("statusText: " + response.statusText);
				reject(error);
			}
		});
	});
}

async function getIsgStatus(sidePath) {
	const $ = await getHTML(sidePath);

	if($) {
		const submenu = $("#sub_nav")
			.children()
			.first()
			.text()
			.replace(/[-/]+/g,"_")
			.replace(/[ .]+/g,"")
			.replace(/[\u00df]+/g,"SS");

		$(".info").each((_i, el) => {
			let group = $(el)
				.find(".round-top")
				.text()
				.replace(/[ -]+/g,"_")
				.replace(/[.]+/g,"")
				.replace(/[\u00df]+/,"SS");

			group = submenu + "." + group;

			$(el).find("tr").each(function() {
				const valueName = $(this)
					.find(".key")
					.text();

				const key = $(this)
					.find(".key")
					.text()
					.replace(/[ -]+/g,"_")
					.replace(/[.]+/g,"")
					.replace(/[\u00df]+/,"SS");

				//<img src="./pics/tec-symbol_an-8e8e8e.png" height="15">
				const param = $(this)
					.find(".value")
					.html();

				let value;

				if(param !== null){
					if (param.search("symbol_an") > -1){
						value = true;
					}
				}

				const valType = typeof value;
				let valThisType = "state";

				if(valType !== null) {
					if(value === true || value === false) {
						valThisType = "boolean";
					} else {
						valThisType = "state";
					}
				}

				if(value === true){
					updateState (translateName("info") + "." + group,key,translateName(valueName),valThisType,"","indicator.state",value);
				}
			});
		});
	}
}

async function getIsgValues(sidePath) {
	const $ = await getHTML(sidePath);

	if($) {
		const submenu = $("#sub_nav")
			.children()
			.first()
			.text()
			.replace(/[-/]+/g,"_")
			.replace(/[ .]+/g,"")
			.replace(/[\u00df]+/g,"SS");

		$(".info").each((_i, el) => {
			let group = $(el)
				.find(".round-top")
				.text()
				.replace(/[ -]+/g,"_")
				.replace(/[.]+/g,"")
				.replace(/[\u00df]+/,"SS");

			group = submenu + "." + group;

			$(el).find("tr").each(function() {
				const valueName = $(this)
					.find(".key")
					.text();

				const key = $(this)
					.find(".key")
					.text()
					.replace(/[ -]+/g,"_")
					.replace(/[.]+/g,"")
					.replace(/[\u00df]+/,"SS");

				const param = $(this)
					.find(".value")
					.text()
					.replace(/,/,".");

				const value = parseFloat(param);
				const unit = param
					.replace(/[ ]{0,2}/, "")
					.replace(/ /g,"")
					.replace(value, "")
					.replace(/([.0][0]){1}?/, "")
					.replace(/^0+/, "");

				const valType = typeof value;
				let valueRole;

				if (key.search("TEMP") > -1 || key.search("SOLLWERT_HK") == 0 || key.search("ISTWERT_HK") == 0){
					valueRole = "value.temperature";
				} else if (key.search("DRUCK") > -1){
					valueRole = "value.pressure";
				} else if (key.search("P_") == 0){
					valueRole = "value.power.consumption";
				} else if (key.search("FEUCHTE") > -1){
					valueRole = "value.humidity";
				} else {
					valueRole = "value";
				}

				if(key && value != null && !isNaN(value)){
					updateState (translateName("info") + "." + group,key,translateName(valueName),valType,unit,valueRole,value);
				}
			});
		});
	}
}

function createISGCommands (strGroup,valTag,valTagLang,valType,valUnit,valRole,valValue,valStates,valMin,valMax) {
	if(adapter.config.isgUmlauts == "no"){
		valTag = Umlauts(valTag);
		strGroup = Umlauts(strGroup);
	}

	valTag = valTag.replace(/[*]+/g,"_");

	valUnit = valUnit.replace(/ +0+/g,"");

	const splitPath = strGroup.split(".");
	const endPaths = [splitPath[0]];
	for(let i = 1; i <= splitPath.length-1; i++){
		endPaths.push(endPaths[i-1] + "." + splitPath[i]);
	}
	endPaths.forEach(element => adapter.setObjectNotExists(
		element, {
			type: "channel"
		},
	));

	const commonobj = {
		name: valTagLang,
		type: valType,
		read: true,
		write: true,
		unit: valUnit,
		role: valRole,
		min: parseInt(valMin),
		max: parseInt(valMax),
		states: valStates
	};

	if(isNaN(parseInt(valMin))) {
		delete commonobj.min;
	}

	if(isNaN(parseInt(valMax))) {
		delete commonobj.max;
	}

	adapter.setObjectNotExists(
		strGroup + "." + valTag, {
			type: "state",
			common: commonobj,
			native: {}
		}, function() {
			adapter.setState(
				strGroup + "." + valTag,
				{val: valValue, ack: true}
			);
		}
	);
}

async function getIsgCommands(sidePath) {
	const $ = await getHTML(sidePath);

	if($) {
		let group;

		try {
			group = $("#sub_nav")
				.children()
				.first()
				.text()
				.replace(/[-/]+/g,"_")
				.replace(/[ .]+/g,"")
				.replace(/[\u00df]+/g,"SS");
		}
		catch (e) {
			adapter.log.error("#sub_nav error:");
			adapter.log.error(e);
			group = "Allgemein";
		}

		const submenu = $.html().match(/#subnavactivename"\).html\('(.*?)'/);
		let submenupath = "";

		//Infografiken Startseite
		if(sidePath == "0"){
			let scriptValues;
			const group = "ANLAGE.STATISTIK";
			try {
				scriptValues = $("#buehne").next().next().get()[0].children[0].data;
			} catch (e){
				try {
					scriptValues = $("#buehne").next().next().next().get()[0].children[0].data;
				} catch (e){/***/}
			}
			if(scriptValues){
				const regexp = /charts\[(\d)\]\['([\w]*)'\]\s*= [[]{1}(.*?)\];{1}/gm;
				let graphsValues;
				do {
					graphsValues = regexp.exec(scriptValues);
					if (graphsValues) {
						const tabs = $("#tab" + graphsValues[1]).find("h3").text().split("in ");
						const valueName = tabs[0];
						const graphUnit = tabs[1];
						const valThisType = "number";
						let values = graphsValues[3].substr(1,graphsValues[3].length-2);
						values = values.split("],[");

						let prevValue;

						values.forEach(function(item){
							const valueact = item.split(",");
							const key = valueName + "_" + graphsValues[2];
							const value = parseInt(valueact[1]);

							let valueRole;

							if (key.search("temperatur") > -1){
								valueRole = "value.temperature";
							} else if (key.search("energie") > -1){
								valueRole = "value.power.consumption";
							} else {
								valueRole = "indicator.state";
							}

							if (prevValue !== valueact[0]){
								updateState (translateName("info") + "." + group + "." + valueName.toLocaleUpperCase() + ".LATEST_VALUE",key.toLocaleUpperCase(),valueName,valThisType,graphUnit,valueRole,value);
							}
							prevValue = valueact[0];

							updateState (translateName("info") + "." + group + "." + valueName.toLocaleUpperCase() + "." + valueact[0].slice(1,valueact[0].length-1).toLocaleUpperCase(),key.toLocaleUpperCase(),valueName,valThisType,graphUnit,valueRole,value);
						});
					}
				}
				while(graphsValues);
			}
		}

		//Get values from script, because JavaScript isn't running with cheerio.
		$("#werte").find("input").each(function(_i, el) {
			if(sidePath == "0"){
				let valCommand;
				let idCommand;
				let statesCommand;
				const nameCommand = $(el).parent().parent().find("h3").text();
				if(nameCommand == "Betriebsart"){
					const idStartCommand = $(el).attr("name");
					if(idStartCommand.match(/aval/)) {
						$(el).parent().parent().parent().parent().find("div.values").each(function(_j, ele){
							statesCommand = "{";
							$(ele).find("input").each(function(_k,elem){
								idCommand = $(elem).attr("name");
								if(!(idCommand.match(/aval/) || idCommand.match(/info/))) {
									if(idCommand.match(/[0-9]s/)){
										if(statesCommand !== "{"){
											statesCommand += ",";
										}
										statesCommand += '"' + $(elem).attr("value") + '":"' + $(elem).next().text() + '"';
									} else {
										valCommand = $(elem).attr("value");
										valCommand = parseFloat(valCommand.replace(",",".").replace(" ",""));
									}
								}
							});
						});
						statesCommand += "}";
						createISGCommands(translateName("Start"), idCommand, nameCommand, "number","","level",valCommand,statesCommand,"","");
					}
				}
			} else if($(this).parent().find("div.black").html()) {
				$(this).parent().find("div.black").each(function(_j, ele){
					const nameCommand = $(ele).parent().parent().parent().find("h3").text();
					const idCommand = $(ele).find("input").attr("name");
					let valCommand;

					let statesCommand = "{";
					$(ele).find("input").each(function(_j, el){
						if(statesCommand !== "{"){
							statesCommand += ",";
						}
						statesCommand += '"' + $(el).attr("value") + '":"' + $(el).attr("alt") + '"';

						if($(el).attr("checked") == "checked"){
							valCommand = $(el).attr("value");
							valCommand = parseFloat(valCommand.replace(",",".").replace(" ",""));
						}
					});
					statesCommand += "}";
					if(submenu){
						submenupath = "";
						submenupath += "." + submenu[1];
					}
					createISGCommands(translateName("settings") + "." + group + submenupath, idCommand, nameCommand, "number","","level",valCommand,statesCommand,"","");
				});
			} else {
				const parentsClass = $(el)
					.parent()
					.attr("class");

				let scriptValues;

				if (parentsClass == "current"){
					$(el).parent().parent().find("div.black").each(function(_j, ele){
						const nameCommand = $(ele).parent().parent().parent().parent().find("h3").text();
						const idCommand = $(ele).parent().find("input").attr("id");
						let valCommand;

						$(ele).parent().find("input").each(function(_j, el){
							if($(el).attr("checked") == "checked"){
								valCommand = $(el).attr("value");
								valCommand = parseFloat(valCommand.replace(",",".").replace(" ",""));
							}
						});
						if(submenu){
							submenupath = "";
							submenupath += "." + submenu[1];
						}
						updateState(translateName("settings") + "." + group + submenupath, idCommand, translateName(nameCommand), "number", "","level",valCommand);
					});
				} else {
					//ignore hidden fields (chval*)
					let parentsID = $(el).parent().attr("id");

					if(parentsID === undefined) {
						parentsID = $(el).parent().parent().attr("id");
						if(parentsID === undefined) {
							parentsID = "";
						}
					}

					if (parentsID.includes("chval")){
						try {
							scriptValues = $(el)
								.parent()
								.parent()
								.next()
								.next()
								.next()
								.get()[0]
								.children[0]
								.data;
						}
						catch (e){
							try {
								scriptValues = $(el)
									.parent()
									.parent()
									.next()
									.next()
									.next()
									.text();
							}
							catch (e){/***/}
						}

						if(scriptValues){
							const nameCommand = $(el).parent().parent().parent().find("h3").text();
							const minCommand = scriptValues.match(/\['min'] = '(.*?)'/);
							const maxCommand = scriptValues.match(/\['max'] = '(.*?)'/);
							const valCommand = scriptValues.match(/\['val']='(.*?)'/);
							const idCommand = scriptValues.match(/\['id']='(.*?)'/);
							const unitCommand = $(el).parent().parent().parent().find(".append-1").text();

							if(idCommand){
								if(submenu){
									submenupath = "";
									submenupath += "." + submenu[1];
								}
								createISGCommands(translateName("settings") + "." + group + submenupath, idCommand[1], nameCommand, "number",unitCommand,"state",parseFloat(valCommand[1].replace(",",".").replace(" ","")),"",parseFloat(minCommand[1].replace(",",".").replace(" ","")),parseFloat(maxCommand[1].replace(",",".").replace(" ","")));
							}
						}
					} else if (!(parentsID.includes("chval"))) {
						try {
							scriptValues = $(el)
								.next()
								.get()[0]
								.children[0]
								.data;
						}
						catch (e){
							try {
								scriptValues = $(el)
									.next()
									.text();
							}
							catch (e){/***/}
						}

						if(scriptValues){
							const nameCommand = $(el).parent().parent().find("h3").text();

							const minCommand = scriptValues.match(/\['min'] = '(.*?)'/);
							const maxCommand = scriptValues.match(/\['max'] = '(.*?)'/);
							const valCommand = scriptValues.match(/\['val']='(.*?)'/);
							const idCommand = scriptValues.match(/\['id']='(.*?)'/);
							const unitCommand = $(el).parent().parent().find(".append-1").text();

							if(idCommand){
								if(submenu){
									submenupath = "";
									submenupath += "." + submenu[1];
								}
								createISGCommands(translateName("settings") + "." + group + submenupath, idCommand[1], nameCommand, "number",unitCommand,"state",parseFloat(valCommand[1].replace(",",".").replace(" ","")),"",parseFloat(minCommand[1].replace(",",".").replace(" ","")),parseFloat(maxCommand[1].replace(",",".").replace(" ","")));
							}
						}
					}
				}
			}
		});
		//"Info_alone" Felder
		$("#werte").find(".info_alone").each(function(_i, el) {
			let valValue = $(el).text();
			valValue = parseFloat(valValue.replace(",",".").replace(" ",""));
			const nameCommand = $(el).parent().parent().find("h3").text();
			const idCommand = $(el).parent().parent().attr("id");
			const unitCommand = $(el).parent().parent().find(".append-1").text();

			if(valValue){
				if(submenu){
					submenupath = "";
					submenupath += "." + submenu[1];
				}
				updateState(translateName("settings") + "." + group + submenupath, idCommand, translateName(nameCommand), "number",unitCommand,"state",valValue);
			}
		});
	}
}

function setIsgCommands(strKey, strValue) {
	const newCommand =
        {"name": strKey,
        	"value": strValue};

	commands.push(newCommand);

	const payload = querystring.stringify({
		user: adapter.config.isgUser,
		pass: adapter.config.isgPassword,
		data: JSON.stringify(commands)
	});

	const postOptions = {
		method: "POST",
		uri: host + "/save.php",
		port: "80",
		body: payload,
		jar: getJar(),
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"Accept": "*/*"
		}
	};

	//send all settings to device after waitingtime of 5 Seconds. If more commands are sent.
	clearTimeout(CommandTimeout);
	CommandTimeout = setTimeout(function(){
		request(postOptions, function (error, response, _content) {
			if (!error && response.statusCode == 200) {
				commandPaths.forEach(function(item){
					getIsgCommands(item);
				});
			} else if (error) {
				adapter.log.error("Error: " + error);
			} else if (response.statusCode !== 200) {
				adapter.log.error("statusCode: " + response.statusCode);
				adapter.log.error("statusText: " + response.statusText);
			}
		});
		commands = [];
	},5000);
}

function Umlauts(text_string) {
	return text_string
		.replace(/[\u00c4]+/g,"AE")
		.replace(/[\u00d6]+/g,"OE")
		.replace(/[\u00dc]+/g,"UE");
}

function main() {
	adapter.setObjectNotExists(
		"ISGReboot", {
			type: "state",
			common: {
				name: translateName("ISGReboot"),
				type: "boolean",
				role: "button",
				read: true,
				write: true
			},
			native: {}
		},
		adapter.subscribeStates("ISGReboot")
	);

	host = adapter.config.isgAddress;
	if(host.search(/http/i) == -1){
		host = "http://" + host;
	}
	adapter.subscribeStates("*");

	statusPaths.forEach(function(item){
		getIsgStatus(item);
	});

	valuePaths.forEach(function(item){
		getIsgValues(item);
	});

	commandPaths.forEach(function(item){
		getIsgCommands(item);
	});

	isgIntervall = setInterval(function(){
		valuePaths.forEach(function(item){
			getIsgValues(item);
		}), statusPaths.forEach(function(item){
			getIsgStatus(item);
		});
	}, (adapter.config.isgIntervall * 1000));



	isgCommandIntervall = setInterval(function(){
		commandPaths.forEach(function(item){
			getIsgCommands(item);
		});
	}, (adapter.config.isgCommandIntervall * 1000));
}

function rebootISG(){
	request("http://" + host + "/reboot.php", { json: true }, (err, _res, _body) => {
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