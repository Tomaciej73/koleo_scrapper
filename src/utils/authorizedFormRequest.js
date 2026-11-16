import formRequest from "./formRequest.js";

const authorizedFormRequest = async (endpoint, accessToken, body = null, requestOptions = {}) => {
    return formRequest(endpoint, body, accessToken, requestOptions);
};

export default authorizedFormRequest;
