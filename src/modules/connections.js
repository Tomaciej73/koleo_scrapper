import BaseModule from "./BaseModule.js";
import Converters from "./converters.js";
import Stations from "./stations.js";
import Types from "./types.js";

/**
 * Module for searching train connections and retrieving their details.
 * @extends BaseModule
 */
export default class Connections extends BaseModule {
  /**
   * Searches for connections between two stations.
   * 
   * @param {string} stationFrom - Name of the departure station.
   * @param {string} stationTo - Name of the arrival station.
   * @param {string} [departureAfter=Types.DEP_DATE.now] - Departure date/time in ISO 8601 format.
   * @param {boolean} [onlyDirect=false] - Whether to search for direct connections only.
   * @returns {Promise<Array|object>} List of connections or error object.
   * @throws {Error} If required parameters are missing.
   */
  async findConnection(stationFrom, stationTo, departureAfter = Types.DEP_DATE.now, onlyDirect = false) {    
    if (!stationFrom || !stationTo || !departureAfter) {
      throw new Error("Station from, station to and departure after are required");
    }
    const conv = new Converters(this.clientOptions);
    const stations = new Stations(this.clientOptions);

    const stationFromSlug = await conv.nameToSlug(stationFrom, true);
    const stationToSlug = await conv.nameToSlug(stationTo, true);

    if (!stationFromSlug.isValidByKoleo || !stationToSlug.isValidByKoleo) {
      return {
        error: `Failed conversion of station names to slugs. Koleo says that the slugs are not valid.`,
        code: 'slugConversionFailed',
      };
    }

    const stationFromObj = await stations.getBySlug(stationFromSlug.slug);
    const stationToObj = await stations.getBySlug(stationToSlug.slug);

    if (!stationFromObj || !stationToObj) {
      return {
        error: `Failed to find stations.`,
        code: 'stationsNotFound',
      };
    }

    return this.findConnectionByStationIds(
      stationFromObj.id,
      stationToObj.id,
      departureAfter,
      onlyDirect
    );
  }

  async findConnectionByStationIds(startId, endId, departureAfter = Types.DEP_DATE.now, onlyDirect = false, requestOptions = {}) {
    if (!Number.isInteger(startId) || startId <= 0 || !Number.isInteger(endId) || endId <= 0) {
      throw new Error('Station IDs must be positive integers');
    }
    if (startId === endId) {
      throw new Error('Departure and arrival stations must be different');
    }
    if (!departureAfter) {
      throw new Error('Departure after is required');
    }

    const searchObject = {
        departure_after: departureAfter,
        start_id: startId,
        end_id: endId,
        only_direct: onlyDirect
    };

    const resp = await this.request('/main/eol_connections/search', searchObject, {
      ...requestOptions,
      retryable: true,
    });
    if (resp.length === 0) {
      return {
        error: `No connections found.`,
        code: 'noConnectionsFound',
      };
    }

    return resp;
  }

  /**
   * Retrieves detailed information about a specific connection.
   * 
   * @param {string} connectionId - The UUID of the connection.
   * @returns {Promise<object>} Connection details.
   * @throws {Error} If connection ID is missing or invalid.
   */
  async getConnectionInfo(connectionId) {
    if (!connectionId) {
      throw new Error("Connection ID is required");
    }

    const uuidRegex = Types.KREGEX.connection_id;
    if (!uuidRegex.test(connectionId)) {
        throw new Error("Invalid Connection ID format. Expected UUID.");
    }
    
    let resp = await this.request(`/main/eol_connections/${connectionId}`);
    return resp;
  }

  /**
   * Retrieves the ticket price for a specific connection.
   * 
   * @param {string} connectionId - The UUID of the connection.
   * @returns {Promise<object>} Price information.
   * @throws {Error} If connection ID is missing or invalid.
   */
  async getConnectionTicketPrice(connectionId) {
    if (!connectionId) {
      throw new Error("Connection ID is required");
    }

    const uuidRegex = Types.KREGEX.connection_id;
    if (!uuidRegex.test(connectionId)) {
        throw new Error("Invalid Connection ID format. Expected UUID.");
    }
    
    let response = await this.request(`/main/eol_connections/${connectionId}/price`);
    return response;
  }     
}
