// Protocol-specific keys. Brand names here identify wire protocols, not app branding.
const SAMSUNG_KEYS = {
  powerOff:'KEY_POWEROFF', volumeUp:'KEY_VOLUP', volumeDown:'KEY_VOLDOWN', toggleMute:'KEY_MUTE',
  buttonUp:'KEY_UP', buttonDown:'KEY_DOWN', buttonLeft:'KEY_LEFT', buttonRight:'KEY_RIGHT',
  buttonEnter:'KEY_ENTER', buttonHome:'KEY_HOME', buttonBack:'KEY_RETURN', buttonExit:'KEY_EXIT',
  channelUp:'KEY_CHUP', channelDown:'KEY_CHDOWN', input:'KEY_SOURCE', liveTv:'KEY_TV',
  guide:'KEY_GUIDE', info:'KEY_INFO', captions:'KEY_CAPTION', quickMenu:'KEY_MENU',
  buttonList:'KEY_CH_LIST', previousChannel:'KEY_PRECH', play:'KEY_PLAY', pause:'KEY_PAUSE',
  stop:'KEY_STOP', rewind:'KEY_REWIND', fastForward:'KEY_FF', red:'KEY_RED', green:'KEY_GREEN',
  yellow:'KEY_YELLOW', blue:'KEY_BLUE', openApps:'KEY_HOME'
};
const ROKU_KEYS = {
  buttonHome:'Home', buttonBack:'Back', buttonUp:'Up', buttonDown:'Down', buttonLeft:'Left',
  buttonRight:'Right', buttonEnter:'Select', play:'Play', rewind:'Rev', fastForward:'Fwd',
  info:'Info', previousChannel:'InstantReplay', openApps:'Home'
};
const ROKU_TV_KEYS = { powerOff:'PowerOff', volumeUp:'VolumeUp', volumeDown:'VolumeDown', toggleMute:'VolumeMute',
  channelUp:'ChannelUp', channelDown:'ChannelDown', liveTv:'InputTuner' };
const ANDROID_KEYS = {
  powerOff:223, buttonHome:3, buttonBack:4, buttonUp:19, buttonDown:20, buttonLeft:21, buttonRight:22,
  buttonEnter:23, volumeUp:24, volumeDown:25, toggleMute:164, channelUp:166, channelDown:167,
  input:178, liveTv:170, guide:172, info:165, captions:175, quickMenu:176, previousChannel:229,
  play:126, pause:127, stop:86, rewind:89, fastForward:90, red:183, green:184, yellow:185, blue:186,
  openApps:3
};
const SYSTEMS = ['auto','webos','netcast','samsung','roku','androidtv'];
function isLocalHost(host) {
  if (typeof host !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const p=host.split('.').map(Number);
  return p.every(n=>n<=255) && (p[0]===10 || p[0]===192&&p[1]===168 || p[0]===172&&p[1]>=16&&p[1]<=31 || p[0]===169&&p[1]===254);
}
function identifySystem(text) {
  if (/roku/i.test(text)) return 'roku';
  if (/samsung/i.test(text)) return 'samsung';
  if (/androidtvremote|android tv|google tv/i.test(text)) return 'androidtv';
  if (/netcast|roap/i.test(text)) return 'netcast';
  if (/webos|web0s/i.test(text)) return 'webos';
  return 'auto';
}
function digitKey(value, prefix, numericOffset) {
  const digit=String(value ?? '');
  if (!/^[0-9]$/.test(digit)) throw new Error('Enter a single digit from 0 to 9.');
  return numericOffset == null ? prefix+digit : Number(digit)+numericOffset;
}
module.exports={SAMSUNG_KEYS,ROKU_KEYS,ROKU_TV_KEYS,ANDROID_KEYS,SYSTEMS,isLocalHost,identifySystem,digitKey};
