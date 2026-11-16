import formRequest from "../utils/formRequest.js";
import authorizedFormRequest from "../utils/authorizedFormRequest.js";

/**
 * Base class for all API modules.
 */
export default class BaseModule {
  constructor(clientOptions = {}) {
    this.clientOptions = clientOptions;
  }

  /**
   * Makes a public API request.
   * 
   * @param {string} endpoint - The API endpoint to call.
   * @param {object|null} [body=null] - The request body for POST requests.
   * @returns {Promise<any>} The JSON response from the API.
   */
  async request(endpoint, body = null, requestOptions = {}) {
    return formRequest(endpoint, body, null, {
      ...requestOptions,
      client: this.clientOptions,
    });
  }

  /**
   * Makes an authenticated API request.
   * 
   * @param {string} endpoint - The API endpoint to call.
   * @param {string} accessToken - The user's access token.
   * @param {object|null} [body=null] - The request body for POST requests.
   * @returns {Promise<any>} The JSON response from the API.
   */
  async userRequest(endpoint, accessToken, body = null, requestOptions = {}) {
    return authorizedFormRequest(endpoint, accessToken, body, {
      ...requestOptions,
      client: this.clientOptions,
    });
  }
}
