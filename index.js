const axiosRaw = require('axios');
const curlirize = require('axios-curlirize');
const R = require('ramda');
const Promise = require('bluebird');
const assert = require('assert');
const moment = require('moment');
const jwt = require('jsonwebtoken');
const wildcardMatch = require('./utils/wildcardMatch');
const { translateProduct } = require('./resolvers/product');
const { translateAvailability } = require('./resolvers/availability');
const { translateBooking } = require('./resolvers/booking');
const { translateRate } = require('./resolvers/rate');

const endpoint = 'https://api.zaui.io/octo';

const CONCURRENCY = 3; // is this ok ?
if (process.env.debug) {
  curlirize(axiosRaw);
}

const axios = async (...args) => {
  return axiosRaw(...args)
  .catch(err => {
    const errMsg = R.path(['response', 'data', 'error'], err);
    throw errMsg || err;
  });
};

const isNilOrEmpty = R.either(R.isNil, R.isEmpty);

const getHeaders = ({
  affiliateKey,
}) => ({
  Authorization: `Bearer ${affiliateKey}`,
  'Content-Type': 'application/json',
  'OCTO-Capabilities': 'octo/pricing'
});

class Plugin {
  constructor(params) { // we get the env variables from here
    Object.entries(params).forEach(([attr, value]) => {
      this[attr] = value;
    });
    this.tokenTemplate = () => ({
      affiliateKey: {
        type: 'text',
        regExp: /^[0-9a-z]{64}$/,
        description: 'the Api Key provided from Zaui, should be in uuid format',
      },
      supplierId: {
        type: 'text',
        regExp: /^[0-9a-z]{3}$/,
        description: 'supplier Id in Zaui',
      },
    });
  }

  async validateToken({
    token: {
      affiliateKey,
    },
  }) {
    const url = `${endpoint || this.endpoint}/suppliers/`;
    const headers = getHeaders({
      affiliateKey,
    });
    try {
      const suppliers = R.path(['data'], await axios({
        method: 'get',
        url,
        headers,
      }));
      return Array.isArray(suppliers) && suppliers.length > 0;
    } catch (err) {
      return false;
    }
  }

  async searchProducts({
    token: {
      affiliateKey,
      supplierId,
    },
    payload,
    typeDefsAndQueries: {
      productTypeDefs,
      productQuery,
    },
  }) {
    let url = `${endpoint || this.endpoint}/suppliers/${supplierId}/products`;
    if (!isNilOrEmpty(payload)) {
      if (payload.productId) {
        url = `${url}/${payload.productId}`;
      }
    }
    const headers = getHeaders({
      affiliateKey,
    });
    let results = R.pathOr([], ['data'], await axios({
      method: 'get',
      url,
      headers,
    }));
    if (!Array.isArray(results)) results = [results];
    let products = await Promise.map(results, async product => {
      return translateProduct({
        rootValue: product,
        typeDefs: productTypeDefs,
        query: productQuery,
      });
    });
    // dynamic extra filtering
    if (!isNilOrEmpty(payload)) {
      const extraFilters = R.omit(['productId'], payload);
      if (Object.keys(extraFilters).length > 0) {
        products = products.filter(
          product => Object.entries(extraFilters).every(
            ([key, value]) => {
              if (typeof value === 'string') return wildcardMatch(value, product[key]);
              return true;
            },
          ),
        );
      }
    }
    return ({ products });
  }

  async searchQuote({
    token: {
      affiliateKey,
      supplierId,
    },
    payload: {
      productIds,
      optionIds,
    },
  }) {
    return { quote: [] };
  }

  async searchAvailability({
    token: {
      affiliateKey,
      supplierId,
    },
    payload: {
      productIds,
      optionIds,
      units,
      startDate,
      endDate,
      dateFormat,
      currency,
    },
    typeDefsAndQueries: {
      availTypeDefs,
      availQuery,
    },
  }) {
    assert(this.jwtKey, 'JWT secret should be set');
    assert(
      productIds.length === optionIds.length,
      'mismatched productIds/options length',
    );
    assert(
      optionIds.length === units.length,
      'mismatched options/units length',
    );
    assert(productIds.every(Boolean), 'some invalid productId(s)');
    assert(optionIds.every(Boolean), 'some invalid optionId(s)');
    const localDateStart = moment(startDate, dateFormat).format('YYYY-MM-DD');
    const localDateEnd = moment(endDate, dateFormat).format('YYYY-MM-DD');
    const headers = getHeaders({
      affiliateKey,
    });
    const url = `${endpoint || this.endpoint}/suppliers/${supplierId}/availability`;
    let availability = (
      await Promise.map(productIds, async (productId, ix) => {
        const data = {
          productId,
          optionId: optionIds[ix],
          localDateStart,
          localDateEnd,
          units: units[ix].map(u => ({ id: u.unitId, quantity: u.quantity })),
        };
        if (currency) data.currency = currency;
        // not sending units, zaui only returns pricing and capacity for the units requested
        // we will do some match and filtering later
        const availWithoutUnits = R.path(['data'], await axios({
          method: 'post',
          url,
          data: R.omit(['units'], data),
          headers,
        }));
        const availWithUnits = R.path(['data'], await axios({
          method: 'post',
          url,
          data,
          headers,
        }));
        return availWithUnits.map(avail => {
          const foundMatch = availWithoutUnits.find(a => a.id === avail.id);
          if (!foundMatch) return avail;
          return {
            ...avail,
            unitPricing: foundMatch.unitPricing,
          }
        });
      }, { concurrency: CONCURRENCY })
    );
    availability = await Promise.map(availability,
      (avails, ix) => {
        let totalQuantity = 0;
        units[ix].forEach(unit => {
          totalQuantity += unit.quantity;
        });
        return Promise.map(avails,
          avail => translateAvailability({
            typeDefs: availTypeDefs,
            query: availQuery,
            rootValue: {
              ...avail,
              totalQuantity,
            },
            variableValues: {
              productId: productIds[ix],
              optionId: optionIds[ix],
              currency,
              unitsWithQuantity: units[ix],
              jwtKey: this.jwtKey,
            },
          }),
        );
      },
    );
    return { availability };
  }

  async availabilityCalendar({
    token: {
      affiliateKey,
      supplierId,
    },
    payload: {
      productIds,
      optionIds,
      units,
      startDate,
      endDate,
      currency,
      dateFormat,
    },
    typeDefsAndQueries: {
      availTypeDefs,
      availQuery,
    },
  }) {
    assert(this.jwtKey, 'JWT secret should be set');
    assert(
      productIds.length === optionIds.length,
      'mismatched productIds/options length',
    );
    assert(
      optionIds.length === units.length,
      'mismatched options/units length',
    );
    assert(productIds.every(Boolean), 'some invalid productId(s)');
    assert(optionIds.every(Boolean), 'some invalid optionId(s)');
    const localDateStart = moment(startDate, dateFormat).format('YYYY-MM-DD');
    const localDateEnd = moment(endDate, dateFormat).format('YYYY-MM-DD');
    const headers = getHeaders({
      affiliateKey,
    });
    const url = `${endpoint || this.endpoint}/suppliers/${supplierId}/availability`;
    const availability = (
      await Promise.map(productIds, async (productId, ix) => {
        const data = {
          productId,
          optionId: optionIds[ix],
          localDateStart,
          localDateEnd,
          // units is required here to get the total pricing for the calendar
          units: units[ix].map(u => ({ id: u.unitId, quantity: u.quantity })),
        };
        if (currency) data.currency = currency;
        const result = await axios({
          method: 'post',
          url,
          data,
          headers,
        });
        return Promise.map(result.data, avail => translateAvailability({
          rootValue: { ...avail, totalQuantity: 1 },
          typeDefs: availTypeDefs,
          query: availQuery,
        }))
      }, { concurrency: CONCURRENCY })
    );
    return { availability };
  }

  async createBooking({
    token: {
      affiliateKey,
      supplierId,
    },
    token,
    payload: {
      availabilityKey,
      holder,
      notes,
      reference,
      settlementMethod,
    },
    typeDefsAndQueries,
    typeDefsAndQueries: {
      bookingTypeDefs,
      bookingQuery,
    },
  }) {
    assert(availabilityKey, 'an availability code is required !');
    assert(R.path(['name'], holder), 'a holder\' first name is required');
    assert(R.path(['surname'], holder), 'a holder\' surname is required');
    const headers = getHeaders({
      affiliateKey,
    });
    const urlForCreateBooking = `${endpoint || this.endpoint}/suppliers/${supplierId}/bookings`;
    const dataFromAvailKey = await jwt.verify(availabilityKey, this.jwtKey);
    let booking = R.path(['data'], await axios({
      method: 'post',
      url: urlForCreateBooking,
      data: {
        settlementMethod,
        ...dataFromAvailKey,
        notes,
      },
      headers,
    }));
    const dataForConfirmBooking = {
      contact: {
        fullName: `${holder.name} ${holder.surname}`,
        emailAddress: R.path(['emailAddress'], holder),
        phoneNumber: R.path(['phoneNumber'], holder),
        locales: R.path(['locales'], holder),
        country: R.path(['country'], holder),
      },
      notes,
      resellerReference: reference,
      settlementMethod,
    };
    booking = R.path(['data'], await axios({
      method: 'post',
      url: `${endpoint || this.endpoint}/suppliers/${supplierId}/bookings/${booking.uuid}/confirm`,
      data: dataForConfirmBooking,
      headers,
    }));
    const { products: [product] } = R.path(['data'], await this.searchProducts({
      typeDefsAndQueries,
      token,
      payload: {
        productId: dataFromAvailKey.productId,
      }
    }))
    console.log(booking, product);
    return ({
      booking: await translateBooking({
        rootValue: {
          ...booking,
          option: product.options.find(o => o.id === dataFromAvailKey.optionId),
        },
        typeDefs: bookingTypeDefs,
        query: bookingQuery,
      })
    });
  }

  async cancelBooking({
    token: {
      affiliateKey,
      supplierId,
    },
    payload: {
      bookingId,
      id,
      reason,
    },
    typeDefsAndQueries: {
      bookingTypeDefs,
      bookingQuery,
    },
    typeDefsAndQueries,
    token,
  }) {
    assert(!isNilOrEmpty(bookingId) || !isNilOrEmpty(id), 'Invalid booking id');
    const headers = getHeaders({
      affiliateKey,
    });
    const url = `${endpoint || this.endpoint}/suppliers/${supplierId}/bookings/${bookingId || id}/cancel`;
    const booking = R.path(['data'], await axios({
      method: 'delete',
      url,
      data: { reason },
      headers,
    }));
    const { products: [product] } = R.path(['data'], await this.searchProducts({
      typeDefsAndQueries,
      token,
      payload: {
        productId: booking.productId,
      }
    }))
    return ({
      cancellation: await translateBooking({
        rootValue: {
          ...booking,
          option: product.options.find(o => o.id === booking.optionId),
        },
        typeDefs: bookingTypeDefs,
        query: bookingQuery,
      })
    });
  }

  async searchBooking({
    token: {
      affiliateKey,
      supplierId,
    },
    payload: {
      bookingId,
      resellerReference,
      supplierBookingId,
      travelDateStart,
      travelDateEnd,
      dateFormat,
    },
    typeDefsAndQueries: {
      bookingTypeDefs,
      bookingQuery,
    },
    typeDefsAndQueries,
    token,
  }) {
    // TODO: zaui doesn't have this capability
    return {
      bookings: [],
    };
    assert(
      !isNilOrEmpty(bookingId)
      || !isNilOrEmpty(resellerReference)
      || !isNilOrEmpty(supplierBookingId)
      || !(
        isNilOrEmpty(travelDateStart) && isNilOrEmpty(travelDateEnd) && isNilOrEmpty(dateFormat)
      ),
      'at least one parameter is required',
    );
    const headers = getHeaders({
      affiliateKey,
    });
    const searchByUrl = async url => {
      try {
        return R.path(['data'], await axios({
          method: 'get',
          url,
          headers,
        }));
      } catch (err) {
        return [];
      }
    };
    const bookings = await (async () => {
      let url;
      if (!isNilOrEmpty(bookingId)) {
        return Promise.all([
          searchByUrl(`${endpoint || this.endpoint}/suppliers/${supplierId}/bookings/${bookingId}`),
          searchByUrl(`${endpoint || this.endpoint}/suppliers/${supplierId}/bookings?resellerReference=${bookingId}`),
          searchByUrl(`${endpoint || this.endpoint}/suppliers/${supplierId}/bookings?supplierReference=${bookingId}`),
        ]);
      }
      if (!isNilOrEmpty(resellerReference)) {
        url = `${endpoint || this.endpoint}/${supplierId}/bookings?resellerReference=${resellerReference}`;
        return R.path(['data'], await axios({
          method: 'get',
          url,
          headers,
        }));
      }
      if (!isNilOrEmpty(supplierBookingId)) {
        url = `${endpoint || this.endpoint}/${supplierId}/bookings?supplierReference=${supplierBookingId}`;
        return R.path(['data'], await axios({
          method: 'get',
          url,
          headers,
        }));
      }
      if (!isNilOrEmpty(travelDateStart)) {
        const localDateStart = moment(travelDateStart, dateFormat).format();
        const localDateEnd = moment(travelDateEnd, dateFormat).format();
        url = `${endpoint || this.endpoint}/${supplierId}/bookings?localDateStart=${encodeURIComponent(localDateStart)}&localDateEnd=${encodeURIComponent(localDateEnd)}`;
        return R.path(['data'], await axios({
          method: 'get',
          url,
          headers,
        }));
      }
      return [];
    })();
    return ({
      bookings: await Promise.map(R.unnest(bookings), async booking => {
        const { products: [product] } = R.path(['data'], await this.searchProducts({
          typeDefsAndQueries,
          token,
          payload: {
            productId: booking.productId,
          }
        }));
        return translateBooking({
          rootValue: {
            ...booking,
            option: product.options.find(o => o.id === booking.optionId),
          },
          typeDefs: bookingTypeDefs,
          query: bookingQuery,
        });
      })
    });
  }
}

module.exports = Plugin;
