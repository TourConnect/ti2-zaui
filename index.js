const axios = require('axios');
const curlirize = require('axios-curlirize');
const R = require('ramda');
const Promise = require('bluebird');
const assert = require('assert');
const moment = require('moment');
const jwt = require('jsonwebtoken');
const wildcardMatch = require('./utils/wildcardMatch');

const endpoint = 'https://api.zaui.io/octo/';

const CONCURRENCY = 3; // is this ok ?
if (process.env.debug) {
  curlirize(axios);
}

const isNilOrEmpty = R.either(R.isNil, R.isEmpty);
const isNilOrEmptyArray = el => {
  if (!Array.isArray(el)) return true;
  return R.isNil(el) || R.isEmpty(el);
};

const doMap = (obj, map, omitParam = []) => {
  const retVal = {};
  const omit = [
    ...omitParam,
    ...Object.keys(map),
  ];
  Object.entries(map).forEach(([attribute, fn]) => {
    const newVal = fn(obj);
    if (newVal !== undefined) {
      retVal[attribute] = newVal;
    }
  });
  return {
    ...retVal,
    ...R.omit(omit, obj),
  };
};

const doMapCurry = mapObj => item => doMap(item, mapObj);

const productMapIn = {
  productId: R.path(['id']),
  productName: o => R.path(['title'], o) || R.prop('internalName', o),
  availableCurrencies: R.path(['availableCurrencies']),
  defaultCurrency: R.path(['defaultCurrency']),
  options: e => R.pathOr(undefined, ['options'], e).map(option => doMap(option, optionMapIn, ['id', 'title'])),
};

const optionMapIn = {
  optionId: R.path(['id']),
  optionName: o => R.path(['title'], o) || R.prop('internalName', o),
  units: option => R.pathOr(undefined, ['units'], option).map(unit => doMap(unit, unitMap)),
};

const rateMap = {
  rateId: R.path(['id']),
  rateName: rateName => R.toLower(R.path(['internalName'], rateName)),
  pricing: R.path(['pricingFrom']),
};

const unitPricingMap = {
  unitId: R.prop('unitId'),
  original: R.prop('original'),
  retail: R.prop('retail'),
  net: R.prop('net'),
  currencyPrecision: R.prop('currencyPrecision'),
};

const availabilityMap = {
  dateTimeStart: root => R.path(['localDateTimeStart'], root) || R.path(['localDate'], root),
  dateTimeEnd: root => R.path(['localDateTimeEnd'], root) || R.path(['localDate'], root),
  allDay: R.path(['allDay']),
  pricing: root => R.path(['pricing'], root) || R.path(['pricingFrom'], root),
  unitPricing: root => {
    let before = [];
    if (R.path(['unitPricing'], root)) before = R.path(['unitPricing'], root);
    else before = R.path(['unitPricingFrom'], root) || [];
    return before.map(item => doMap(item, unitPricingMap));
  },
  vacancies: R.prop('vacancies'),
  offer: avail => (avail.offerCode ? doMap(avail, {
    offerId: R.path(['offerCode']),
    title: R.pathOr(undefined, ['offerTitle']),
    description: R.pathOr(undefined, ['offer', 'description']),
  }) : undefined),
  meetingPoint: avail => (avail.meetingPoint ? doMap(avail, {
    description: R.pathOr(undefined, ['meetingPoint']),
    dateTime: R.pathOr(undefined, ['meetingLocalDateTime']),
    coordinates: () => ((avail.meetingPointLatitude
      && avail.meetingPointLongitude) ? doMap(avail, {
        lat: R.path(['meetingPointLatitude']),
        long: R.path(['meetingPointLongitude']),
      }) : undefined),
  }) : undefined),
};
const capitalize = sParam => {
  if (typeof sParam !== 'string') return '';
  const s = sParam.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

const unitMap = {
  unitId: R.path(['id']),
  unitName: o => R.path(['title'], o) || R.prop('internalName', o),
  type: R.path(['type']),
  subtitle: R.path(['subtitle']),
  restrictions: R.path(['restrictions']),
  pricing: root => R.path(['pricing'], root) || R.path(['pricingFrom'], root),
};

const itineraryMap = {
  name: R.path(['name']),
  type: R.path(['type']),
  address: R.path(['address']),
  coordinates: itinerary => ((itinerary.latitude
    && Boolean(itinerary.longitude)) ? doMap(itinerary, {
      lat: R.path(['latitude']),
      long: R.path(['longitude']),
    }) : undefined),
  duration: ({ duration }) => (isNilOrEmpty(duration) ? undefined : doMapCurry({
    durationName: R.path(['duration']),
    amount: R.path(['durationAmount']),
    unit: R.path(['durationUnit']),
  })),
};

const unitItemMap = {
  unitItemId: R.path(['uuid']),
  unitId: R.path(['unitId']),
  unitName: R.path(['unit', 'title']),
  supplierBookingId: R.path(['supplierReference']),
  status: e => capitalize(R.path(['status'], e)),
  contact: R.path(['contact']),
  pricing: R.path(['pricing']),
  unit: root => doMap(root.unit, unitMap),
};

const contactMapOut = {
  country: R.path(['country']),
  emailAddress: R.path(['emailAddress']),
  name: R.path(['firstName']),
  surname: R.path(['lastName']),
  fullName: R.path(['fullName']),
  locales: R.path(['locales']),
  notes: R.path(['notes']),
  phoneNumber: R.path(['phoneNumber']),
};

const bookingMap = {
  id: R.path(['id']),
  orderId: R.path(['orderReference']),
  bookingId: R.path(['supplierReference']),
  supplierBookingId: R.path(['supplierReference']),
  status: e => capitalize(R.path(['status'], e)),
  productId: R.path(['product', 'id']),
  productName: R.path(['product', 'title']),
  optionId: R.path(['option', 'id']),
  optionName: R.path(['option', 'title']),
  itinerary: ({ option: { itinerary } = {} }) =>
    (isNilOrEmptyArray(itinerary) ? undefined : itinerary.map(doMapCurry(itineraryMap))),
  duration: booking => doMap(booking, {
    durationName: R.path(['duration']),
    amount: R.path(['durationAmount']),
    unit: R.path(['durationUnit']),
  }),
  cancellable: R.path(['cancellable']),
  unitItems: ({ unitItems }) =>
    (isNilOrEmptyArray(unitItems) ? undefined : unitItems.map(doMapCurry(unitItemMap))),
  start: R.path(['availability', 'localDateTimeStart']),
  end: R.path(['availability', 'localDateTimeEnd']),
  allDay: R.path(['availability', 'allDay']),
  bookingDate: R.path(['utcCreatedAt']),
  holder: booking => doMap(R.path(['contact'], booking), contactMapOut),
  telephone: R.pathOr(undefined, ['contact', 'phoneNumber']),
  notes: R.pathOr(undefined, ['notes']),
  price: R.path(['pricing']),
  offer: booking => (booking.offerCode ? doMap(booking, {
    offerId: R.path(['offerCode']),
    title: R.pathOr(undefined, ['offerTitle']),
    description: R.pathOr(undefined, ['offer', 'description']),
  }) : undefined),
  cancelPolicy: R.pathOr(undefined, ['product', 'cancellationPolicy']), // TODO: Looks like cancellation text on appers on the shortDescription of the product entity .. an NLP extractor would be usefull ?
};

const contactMap = {
  fullName: holder => `${holder.name} ${holder.surname}`,
  emailAddress: R.path(['emailAddress']),
  phoneNumber: R.path(['phoneNumber']),
  locales: R.path(['locales']),
  country: R.path(['country']),
};

const getHeaders = ({
  apiKey,
}) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
});

class Plugin {
  constructor(params) { // we get the env variables from here
    Object.entries(params).forEach(([attr, value]) => {
      this[attr] = value;
    });
    this.tokenTemplate = () => ({
      apiKey: {
        type: 'text',
        regExp: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
        description: 'the Api Key provided from Zaui, should be in uuid format',
      },
      supplierId: {
        type: 'text',
        description: 'supplier Id in Zaui',
      },
    });
  }

  async validateToken({
    token: {
      apiKey,
    },
  }) {
    const url = `${endpoint || this.endpoint}/suppliers/`;
    const headers = getHeaders({
      apiKey,
    });
    try {
      const suppliers = await axios({
        method: 'get',
        url,
        headers,
      });
      return Array.isArray(companies) && companies.length > 0;
    } catch (err) {
      return false;
    }
  }

  async searchProducts({
    token: {
      apiKey,
      supplierId,
    },
    payload,
  }) {
    let url = `${endpoint || this.endpoint}/suppliers/${supplierId}/products`;
    if (!isNilOrEmpty(payload)) {
      if (payload.productId) {
        url = `${url}/${payload.productId}`;
      }
    }
    const headers = getHeaders({
      apiKey,
    });
    let results = await axios({
      method: 'get',
      url,
      headers,
    });
    if (!Array.isArray(results)) results = [results];
    let products = results.map(e => doMap(e, productMapIn, ['id', 'title']));
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
      apiKey,
      supplierId,
    },
    payload: {
      productIds,
      optionIds,
      occupancies,
    },
  }) {
    assert(occupancies.length > 0, 'there should be at least one occupancy');
    assert(productIds.length === optionIds.length, 'mismatched product/option combinations');
    assert(productIds.length === occupancies.length, 'mismatched product/occupancies combinations');
    assert(productIds.every(Boolean), 'some invalid productId(s)');
    assert(optionIds.every(Boolean), 'some invalid optionId(s)');
    assert(occupancies.every(Boolean), 'some invalid occupacies(s)');
    const quote = occupancies.map(() => productIds.map(productId => ({ productId })));
    let productsDetail = await Promise.map(R.uniq(productIds), productId => {
      const headers = getHeaders({
        apiKey,
      });
      const url = `${endpoint || this.endpoint}/suppliers/${supplierId}/products/${productId}`;
      return axios({
        method: 'get',
        url,
        headers,
      });
    }, { concurrency: CONCURRENCY }).map(({ data }) => data);
    productsDetail = R.indexBy(R.prop('id'), productsDetail);
    // console.log({ optionIds });
    productIds.forEach((productId, productIdIx) => {
      const optionDetail = productsDetail[productId]
        .options.filter(({ id }) => id === optionIds[productIdIx])[0];
      quote[productIdIx] =
        pickUnit(optionDetail.units, occupancies[productIdIx]).map(e => doMap(e, rateMap));
    });
    return { quote };
  }

  async searchAvailability({
    token: {
      apiKey,
      supplierId,
    },
    token,
    payload: {
      productIds,
      optionIds,
      occupancies,
      startDate,
      endDate,
      dateFormat,
      currency,
    },
  }) {
    assert(this.jwtKey, 'JWT secret should be set');
    assert(occupancies.length > 0, 'there should be at least one occupancy');
    assert(
      productIds.length === optionIds.length,
      'mismatched productIds/options length',
    );
    assert(
      optionIds.length === occupancies.length,
      'mismatched options/occupancies length',
    );
    assert(productIds.every(Boolean), 'some invalid productId(s)');
    assert(optionIds.every(Boolean), 'some invalid optionId(s)');
    assert(occupancies.every(Boolean), 'some invalid occupacies(s)');
    const localDateStart = moment(startDate, dateFormat).format('YYYY-MM-DD');
    const localDateEnd = moment(endDate, dateFormat).format('YYYY-MM-DD');
    // obtain the rates
    const { quote } = await this.searchQuote({
      token,
      payload: {
        productIds,
        optionIds,
        occupancies,
      },
    });
    const rates = quote.map(q => q.map(({ rateId }) => rateId));
    const headers = getHeaders({
      apiKey,
    });
    const url = `${endpoint || this.endpoint}/suppliers/${supplierId}/availability`;
    let availability = (
      await Promise.map(rates, async (rate, rateIx) => {
        const qtys = R.countBy(x => x)(rate);
        const data = {
          productId: productIds[rateIx],
          optionId: optionIds[rateIx],
          localDateStart,
          localDateEnd,
          currency,
          units: Object.entries(qtys).map(([id, quantity]) => ({
            id, quantity,
          })),
        };
        return axios({
          method: 'post',
          url,
          data,
          headers,
        });
      }, { concurrency: CONCURRENCY })
    ).map(({ data }) => data);
    availability = availability.map(
      (avails, availsIx) => (avails.map(
        avail => (avail.available ? ({
          key: jwt.sign(({
            productId: productIds[availsIx],
            optionId: optionIds[availsIx],
            availabilityId: avail.id,
            currency,
            unitItems: rates[availsIx].map(rate => ({ unitId: rate })),
          }), this.jwtKey),
          ...doMap(avail, availabilityMap),
          available: true,
        }) : ({
          available: false,
        })),
      )),
    );
    return { availability };
  }

  async availabilityCalendar({
    token: {
      apiKey,
      supplierId,
    },
    token,
    payload: {
      productIds,
      optionIds,
      occupancies,
      startDate,
      endDate,
      currency,
      dateFormat,
    },
  }) {
    assert(this.jwtKey, 'JWT secret should be set');
    assert(occupancies.length > 0, 'there should be at least one occupancy');
    assert(
      productIds.length === optionIds.length,
      'mismatched productIds/options length',
    );
    assert(
      optionIds.length === occupancies.length,
      'mismatched options/occupancies length',
    );
    assert(productIds.every(Boolean), 'some invalid productId(s)');
    assert(optionIds.every(Boolean), 'some invalid optionId(s)');
    assert(occupancies.every(Boolean), 'some invalid occupacies(s)');
    const localDateStart = moment(startDate, dateFormat).format('YYYY-MM-DD');
    const localDateEnd = moment(endDate, dateFormat).format('YYYY-MM-DD');
    // obtain the rates
    const { quote } = await this.searchQuote({
      token,
      payload: {
        productIds,
        optionIds,
        occupancies,
      },
    });
    const rates = quote.map(q => q.map(({ rateId }) => rateId));
    const headers = getHeaders({
      apiKey,
    });
    const url = `${endpoint || this.endpoint}/suppliers/${supplierId}/availability/calendar`;
    let availability = (
      await Promise.map(rates, async (rate, rateIx) => {
        const qtys = R.countBy(x => x)(rate);
        const data = {
          productId: productIds[rateIx],
          optionId: optionIds[rateIx],
          localDateStart,
          localDateEnd,
          currency,
          units: Object.entries(qtys).map(([id, quantity]) => ({
            id, quantity,
          })),
        };
        return axios({
          method: 'post',
          url,
          data,
          headers,
        });
      }, { concurrency: CONCURRENCY })
    ).map(({ data }) => data);
    availability = availability.map(
      (avails, availsIx) => (avails.map(
        avail => doMap(avail, availabilityMap),
      )),
    );
    return { availability };
  }

  async createBooking({
    token: {
      apiKey,
      supplierId,
    },
    payload: {
      availabilityKey,
      holder,
      notes,
      reference,
      settlementMethod,
    },
  }) {
    assert(availabilityKey, 'an availability code is required !');
    assert(R.path(['name'], holder), 'a holder\' first name is required');
    assert(R.path(['surname'], holder), 'a holder\' surname is required');
    assert(R.path(['emailAddress'], holder), 'a holder\' email address is required');
    const headers = getHeaders({
      apiKey,
    });
    let url = `${endpoint || this.endpoint}/suppliers/${supplierId}/bookings`;
    let data = await jwt.verify(availabilityKey, this.jwtKey);
    let booking = R.path(['data'], await axios({
      method: 'post',
      url,
      data: {
        settlementMethod,
        ...data,
        notes,
      },
      headers,
    }));
    url = `${endpoint || this.endpoint}/suppliers/${supplierId}/bookings/${booking.uuid}/confirm`;
    const contact = doMap(holder, contactMap);
    data = {
      contact,
      notes,
      resellerReference: reference,
      settlementMethod,
    };
    booking = R.path(['data'], await axios({
      method: 'post',
      url,
      data,
      headers,
    }));
    return ({ booking: doMap(booking, bookingMap) });
  }

  async cancelBooking({
    token: {
      apiKey,
      supplierId,
    },
    payload: {
      bookingId,
      id,
      reason,
    },
  }) {
    assert(!isNilOrEmpty(bookingId) || !isNilOrEmpty(id), 'Invalid booking id');
    const headers = getHeaders({
      apiKey,
    });
    const url = `${endpoint || this.endpoint}/suppliers/${supplierId}/bookings/${bookingId || id}/cancel`;
    const booking = R.path(['data'], await axios({
      method: 'delete',
      url,
      data: { reason },
      headers,
    }));
    return ({ cancellation: doMap(booking, bookingMap) });
  }

  async searchBooking({
    token: {
      apiKey,
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
  }) {
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
      apiKey,
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
    return ({ bookings: R.unnest(bookings).map(doMapCurry(bookingMap)) });
  }
}

const pickUnit = (units, paxs) => {
  const evalOne = (unit, pax) => {
    if (pax.age < R.path(['restrictions', 'minAge'], unit)) {
      return false;
    }
    if (pax.age > R.path(['restrictions', 'maxAge'], unit)) {
      return false;
    }
    return true;
  };
  if (paxs.length > 1) { // find group units
    const group = units.filter(({ restrictions }) => Boolean(restrictions)).find(unit => {
      if (
        R.path(['restrictions', 'paxCount'], unit) === paxs.length
        && paxs.every(pax => evalOne(unit, pax))
      ) return true;
      return false;
    });
    if (group) return [group];
  }
  return paxs.map(pax => units
    .filter(unit => R.path(['restrictions', 'paxCount'], unit) === 1)
    .find(unit => evalOne(unit, pax))); // individual units
};

module.exports = Plugin;
module.exports.pickUnit = pickUnit;
