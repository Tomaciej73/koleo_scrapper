import Brands from "./modules/brands.js";
import Discounts from "./modules/discounts.js";
import Stations from "./modules/stations.js";
import Connections from "./modules/connections.js";
import Converters from "./modules/converters.js";
import Types from "./modules/types.js";
import User from "./modules/user.js";

class Koleo {
  constructor(clientOptions = {}) {
    this.brands = new Brands(clientOptions);
    this.discounts = new Discounts(clientOptions);
    this.stations = new Stations(clientOptions);
    this.connections = new Connections(clientOptions);
    this.converters = new Converters(clientOptions);
    this.types = new Types(clientOptions);
    this.user = new User(clientOptions);
  }
}


export default Koleo;
