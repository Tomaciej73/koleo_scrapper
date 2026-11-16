const createHeaders = (config, eolAdditionalHeader=true, accessToken=null) => {
    let HDR = {
      accept: "application/json, text/plain, */*",
      "user-agent": config.userAgent,
      "x-koleo-client": config.clientName,
      "x-koleo-version": config.clientVersion,
    };
    
    if (accessToken) {
        HDR["Authorization"] = `Bearer ${accessToken}`;
    }
    
    if (eolAdditionalHeader) {
      HDR = {
        ...HDR,
        "accept-eol-response-version": config.eolResponseVersion,
        "content-type": "application/json",
      }
    }
    return HDR;
}

export default createHeaders;
