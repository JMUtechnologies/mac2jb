function validate(value){
 const requirements=[];
 if(value.cardputerApiKeyEnv&&!/^[A-Z_][A-Z0-9_]*$/.test(value.cardputerApiKeyEnv))throw Error('Invalid Cardputer API key environment variable');
 if(value.cardputerEndpoint){const url=new URL(value.cardputerEndpoint);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Use a plain HTTP(S) Cardputer endpoint without embedded credentials');value.cardputerEndpoint=url.href.replace(/\/$/,'');}
 if(!value.cardputerEndpoint)requirements.push('Set the Cardputer KProx endpoint.');
 if(value.cardputerFirmware!=='kprox')requirements.push('Install KProx firmware on Cardputer ADV and enable its USB keyboard.');
 if(!['on','off'].includes(value.cardputerCapsLock))requirements.push('Confirm the keyboard Caps Lock state on Switch.');
 if(!process.env[value.cardputerApiKeyEnv])requirements.push('Set '+value.cardputerApiKeyEnv+' for the Cardputer API key.');
 return requirements;
}
module.exports={validate};
