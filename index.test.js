/* globals describe, beforeAll, it, expect */
const R = require('ramda');
const moment = require('moment');
const faker = require('faker');

const Plugin = require('./index');

const { typeDefs: productTypeDefs, query: productQuery } = require('./node_modules/ti2/controllers/graphql-schemas/product');
const { typeDefs: availTypeDefs, query: availQuery } = require('./node_modules/ti2/controllers/graphql-schemas/availability');
const { typeDefs: bookingTypeDefs, query: bookingQuery } = require('./node_modules/ti2/controllers/graphql-schemas/booking');
const { typeDefs: rateTypeDefs, query: rateQuery } = require('./node_modules/ti2/controllers/graphql-schemas/rate');
const { typeDefs: pickupTypeDefs, query: pickupQuery } = require('./node_modules/ti2/controllers/graphql-schemas/pickup-point');

const typeDefsAndQueries = {
  productTypeDefs,
  productQuery,
  availTypeDefs,
  availQuery,
  bookingTypeDefs,
  bookingQuery,
  rateTypeDefs,
  rateQuery,
  pickupQuery,
  pickupTypeDefs,
};

const app = new Plugin({
  jwtKey: process.env.ti2_zaui_jwtKey,
});
const rnd = arr => arr[Math.floor(Math.random() * arr.length)];

describe('search tests', () => {
  let products;
  let testProduct = {
    productName: 'Vancouver Nights',
  };
  const token = {
    affiliateKey: process.env.ti2_zaui_apiKey,
    supplierId: process.env.ti2_zaui_supplierId,
  };
  const dateFormat = 'DD/MM/YYYY';
  beforeAll(async () => {
    // nada
  });
  describe('utilities', () => {
    describe('validateToken', () => {
      it('valid token', async () => {
        expect(token).toBeTruthy();
        const retVal = await app.validateToken({
          token,
        });
        expect(retVal).toBeTruthy();
      });
      it('invalid token', async () => {
        const retVal = await app.validateToken({
          token: { someRandom: 'thing' },
        });
        expect(retVal).toBeFalsy();
      });
    });
    describe('template tests', () => {
      let template;
      it('get the template', async () => {
        template = await app.tokenTemplate();
        const rules = Object.keys(template);
        expect(rules).toContain('affiliateKey');
      });
      it('affiliateKey', () => {
        const affiliateKey = template.affiliateKey.regExp;
        expect(affiliateKey.test('something')).toBeFalsy();
        expect(affiliateKey.test('df2ce6e19ba4d3b749c88025d42a9a4e31cd2e9ac603ffd8acedeee615a76e42')).toBeTruthy();
      });
    });
  });
  describe('booking process', () => {
    it('get for all products, a test product should exist', async () => {
      const retVal = await app.searchProducts({
        token,
        typeDefsAndQueries,
      });
      expect(Array.isArray(retVal.products)).toBeTruthy();
      // console.log(retVal.products.filter(({ productName }) => productName === testProduct.productName));
      expect(retVal.products).toContainObject([{
        productName: testProduct.productName,
      }]);
      testProduct = {
        ...retVal.products.find(({ productName }) => productName === testProduct.productName),
      };
      expect(testProduct.productId).toBeTruthy();
    });
    it('should be able to get a single product', async () => {
      const retVal = await app.searchProducts({
        token,
        typeDefsAndQueries,
        payload: {
          productId: testProduct.productId,
        },
      });
      expect(Array.isArray(retVal.products)).toBeTruthy();
      expect(retVal.products).toHaveLength(1);
    });
    let busProducts = [];
    it('should be able to get a product by name', async () => {
      const retVal = await app.searchProducts({
        token,
        typeDefsAndQueries,
        payload: {
          productName: '*night*',
        },
      });
      expect(Array.isArray(retVal.products)).toBeTruthy();
      expect(retVal.products.length).toBeGreaterThan(0);
      busProducts = retVal.products;
    });
    it('should be able to get an availability calendar', async () => {
      const retVal = await app.availabilityCalendar({
        token,
        typeDefsAndQueries,
        payload: {
          startDate: moment().add(1, 'M').format(dateFormat),
          endDate: moment().add(1, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
          productIds: [
            '120',
          ],
          optionIds: ['f4aca5e5f308fa1a9ed0581470cd3b76ab6fd0a5'],
          units: [
            [{ unitId:'adults', quantity: 2 }],
          ],
        },
      });
      expect(retVal).toBeTruthy();
      const { availability } = retVal;
      expect(availability).toHaveLength(1);
      expect(availability[0].length).toBeGreaterThan(0);
    });
    let availabilityKey;
    it('should be able to get availability', async () => {
      const retVal = await app.searchAvailability({
        token,
        typeDefsAndQueries,
        payload: {
          startDate: moment().add(2, 'M').format(dateFormat),
          endDate: moment().add(2, 'M').format(dateFormat),
          dateFormat,
          productIds: [
            '120',
          ],
          optionIds: ['f4aca5e5f308fa1a9ed0581470cd3b76ab6fd0a5'],
          units: [
            [{ unitId:'adults', quantity: 2 }],
          ],
        },
      });
      expect(retVal).toBeTruthy();
      const { availability } = retVal;
      expect(availability).toHaveLength(1);
      expect(availability[0].length).toBeGreaterThan(0);
      availabilityKey = R.path([0, 0, 'key'], availability);
      expect(availabilityKey).toBeTruthy();
    });
    let booking;
    const reference = faker.datatype.uuid();
    it('should be able to create a booking', async () => {
      const fullName = faker.name.findName().split(' ');
      const retVal = await app.createBooking({
        token,
        typeDefsAndQueries,
        payload: {
          availabilityKey,
          notes: faker.lorem.paragraph(),
          settlementMethod: 'DEFERRED',
          holder: {
            name: fullName[0],
            surname: fullName[1],
            phoneNumber: faker.phone.phoneNumber(),
            emailAddress: `morry+tests_${faker.lorem.slug()}@tourconnect.com`,
            country: faker.address.countryCode(),
            locales: ['en-US', 'en', 'es'],
          },
          reference,
        },
      });
      expect(retVal.booking).toBeTruthy();
      ({ booking } = retVal);
      expect(booking).toBeTruthy();
      expect(R.path(['id'], booking)).toBeTruthy();
      expect(R.path(['supplierBookingId'], booking)).toBeTruthy();
      expect(R.path(['cancellable'], booking)).toBeTruthy();
    });
    let bookings = [];
    it('it should be able to search bookings by id', async () => {
      const retVal = await app.searchBooking({
        token,
        typeDefsAndQueries,
        payload: {
          bookingId: booking.id,
        },
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy();
    });
    it('it should be able to search bookings by reference', async () => {
      const retVal = await app.searchBooking({
        token,
        typeDefsAndQueries,
        payload: {
          bookingId: reference,
        },
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy();
    });
    it('it should be able to search bookings by supplierBookingId', async () => {
      const retVal = await app.searchBooking({
        token,
        typeDefsAndQueries,
        payload: {
          bookingId: booking.supplierBookingId,
        },
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy();
    });
    it('it should be able to search bookings by travelDate', async () => {
      const retVal = await app.searchBooking({
        token,
        typeDefsAndQueries,
        payload: {
          travelDateStart: moment().add(2, 'M').format(dateFormat),
          travelDateEnd: moment().add(2, 'M').format(dateFormat),
          dateFormat,
        },
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy();
    });
    it('should be able to cancel the booking', async () => {
      const retVal = await app.cancelBooking({
        token,
        typeDefsAndQueries,
        payload: {
          bookingId: booking.id,
          reason: faker.lorem.paragraph(),
        },
      });
      const { cancellation } = retVal;
      expect(cancellation).toBeTruthy();
      expect(R.path(['id'], cancellation)).toBeTruthy();
      expect(R.path(['cancellable'], cancellation)).toBeFalsy();
    });
  });
});
