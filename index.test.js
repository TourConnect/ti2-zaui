/* globals describe, beforeAll, it, expect */
const R = require('ramda');
const moment = require('moment');
const faker = require('faker');

const Plugin = require('./index');
const fixtureUnits = require('./__fixtures__/units.js');

const app = new Plugin({
  jwtKey: process.env.ti2_zaui_jwtKey,
});

const rnd = arr => arr[Math.floor(Math.random() * arr.length)];

describe('search tests', () => {
  let products;
  let testProduct = {
    productName: 'Pub Crawl Tour',
  };
  const token = {
    apiKey: process.env.ti2_zaui_apiKey,
  };
  const dateFormat = 'DD/MM/YYYY';
  beforeAll(async () => {
    // nada
  });
  describe('utilities', () => {
    describe('validateToken', () => {
      it('valid token', async () => {
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
        expect(affiliateKey.test('f5eb2e1f-4b8f-4b43-a858-4a12d77b8299')).toBeTruthy();
      });
    });
  });
  describe('booking process', () => {
    it('get for all products, a test product should exist', async () => {
      const retVal = await app.searchProducts({
        token,
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
        payload: {
          productName: '*bus*',
        },
      });
      expect(Array.isArray(retVal.products)).toBeTruthy();
      expect(retVal.products.length).toBeGreaterThan(0);
      busProducts = retVal.products;
    });
    it('should be able to get an availability calendar', async () => {
      const retVal = await app.availabilityCalendar({
        token,
        payload: {
          startDate: moment().add(6, 'M').format(dateFormat),
          endDate: moment().add(6, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
          productIds: [
            '28ca088b-bc7b-4746-ab06-5971f1ed5a5e',
            '5d981651-e204-4549-bfbe-691043dd2515',
          ],
          optionIds: ['DEFAULT', 'DEFAULT'],
          occupancies: [
            [{ age: 30 }, { age: 40 }],
            [{ age: 30 }, { age: 40 }],
          ],
        },
      });
      expect(retVal).toBeTruthy();
      const { availability } = retVal;
      expect(availability).toHaveLength(2);
      expect(availability[0].length).toBeGreaterThan(0);
    });
    it('should be able to get quotes', async () => {
      const retVal = await app.searchQuote({
        token,
        payload: {
          startDate: moment().add(6, 'M').format(dateFormat),
          endDate: moment().add(6, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
          productIds: busProducts.map(({ productId }) => productId),
          optionIds: busProducts.map(({ options }) =>
            faker.random.arrayElement(options).optionId),
          occupancies: [
            [{ age: 30 }, { age: 40 }],
            [{ age: 30 }, { age: 40 }],
          ],
        },
      });
      expect(retVal).toBeTruthy();
      const { quote } = retVal;
      expect(quote.length).toBeGreaterThan(0);
      expect(quote[0]).toContainObject([{
        rateName: 'adult',
        pricing: expect.toContainObject([{
          currency: 'USD',
        }]),
      }]);
    });
    let availabilityKey;
    it('should be able to get availability', async () => {
      const retVal = await app.searchAvailability({
        token,
        payload: {
          startDate: moment().add(6, 'M').format(dateFormat),
          endDate: moment().add(6, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
          productIds: [
            '28ca088b-bc7b-4746-ab06-5971f1ed5a5e',
            '5d981651-e204-4549-bfbe-691043dd2515',
          ],
          optionIds: ['DEFAULT', 'DEFAULT'],
          occupancies: [
            [{ age: 30 }, { age: 40 }],
            [{ age: 30 }, { age: 40 }],
          ],
        },
      });
      expect(retVal).toBeTruthy();
      const { availability } = retVal;
      expect(availability).toHaveLength(2);
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
        payload: {
          availabilityKey,
          notes: faker.lorem.paragraph(),
          settlementMethod: 'DEFERRED',
          holder: {
            name: fullName[0],
            surname: fullName[1],
            phoneNumber: faker.phone.phoneNumber(),
            emailAddress: `salvador+tests_${faker.lorem.slug()}@tourconnect.com`,
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
      // console.log({ booking });
    });
    it('should be able to cancel the booking', async () => {
      const retVal = await app.cancelBooking({
        token,
        payload: {
          bookingId: booking.id,
          reason: faker.lorem.paragraph(),
        },
      });
      const { cancellation } = retVal;
      expect(cancellation).toBeTruthy();
      expect(cancellation).toBeTruthy();
      expect(R.path(['id'], cancellation)).toBeTruthy();
      expect(R.path(['cancellable'], cancellation)).toBeFalsy();
    });
    let bookings = [];
    it('it should be able to search bookings by id', async () => {
      const retVal = await app.searchBooking({
        token,
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
        payload: {
          travelDateStart: moment().add(6, 'M').format(dateFormat),
          travelDateEnd: moment().add(6, 'M').add(2, 'd').format(dateFormat),
          dateFormat,
        },
      });
      expect(Array.isArray(retVal.bookings)).toBeTruthy();
      ({ bookings } = retVal);
      expect(R.path([0, 'id'], bookings)).toBeTruthy();
    });
    it('should be able to create a booking for a referrer', async () => {
      const fullName = faker.name.findName().split(' ');
      const retVal = await app.createBooking({
        token,
        payload: {
          availabilityKey,
          notes: faker.lorem.paragraph(),
          holder: {
            name: fullName[0],
            surname: fullName[1],
            phoneNumber: faker.phone.phoneNumber(),
            emailAddress: `salvador+tests_${faker.lorem.slug()}@tourconnect.com`,
            country: faker.address.countryCode(),
            locales: ['en-US', 'en', 'es'],
          },
          reference,
          referrer: 'referrerforapitest',
          settlementMethod: 'DEFERRED',
        },
      });
      expect(retVal.booking).toBeTruthy();
      ({ booking } = retVal);
      expect(booking).toBeTruthy();
      expect(R.path(['id'], booking)).toBeTruthy();
      expect(R.path(['supplierBookingId'], booking)).toBeTruthy();
      expect(R.path(['cancellable'], booking)).toBeTruthy();
    });
  });
});
