const { makeExecutableSchema } = require('@graphql-tools/schema');
const R = require('ramda');
const { graphql } = require('graphql');

const capitalize = sParam => {
  if (typeof sParam !== 'string') return '';
  const s = sParam.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};
const isNilOrEmptyArray = el => {
  if (!Array.isArray(el)) return true;
  return R.isNil(el) || R.isEmpty(el);
};

const resolvers = {
  Query: {
    id: R.path(['id']),
    orderId: R.pathOr('', ['orderReference']),
    bookingId: R.pathOr('', ['id']),
    supplierBookingId: R.path(['supplierReference']),
    status: e => capitalize(R.path(['status'], e)),
    productId: R.path(['product', 'id']),
    productName: R.path(['product', 'internalName']),
    cancellable: root => {
      if (root.status === 'CANCELLED') return false;
      return root.cancellable;
    },
    editable: root => {
      if (root.status === 'CANCELLED') return false;
      return root.cancellable;
    },
    unitItems: ({ unitItems = [] }) => unitItems.map(unitItem => ({
      unitItemId: R.path(['uuid'], unitItem),
      unitId: R.path(['unitId'], unitItem),
      unitName: (() =>  {
        // user (prince of whales) prefer to use "reference" instead of "internalName"
        // because internalName is "STUDENT", and they prefer to use "Youth"
        if (R.pathOr('', ['unit', 'reference'], unitItem)) {
          const reference = R.pathOr('', ['unit', 'reference'], unitItem);
          if (reference.includes('(')) {
            return reference.split('(')[0].trim();
          }
          return reference;
        }
        return R.pathOr('', ['unit', 'internalName'], unitItem);
      })(),
    })),
    start: R.path(['availability', 'localDateTimeStart']),
    end: R.path(['availability', 'localDateTimeEnd']),
    allDay: R.path(['availability', 'allDay']),
    bookingDate: R.path(['utcCreatedAt']),
    holder: root => ({
      name: R.path(['contact', 'firstName'], root),
      surname: R.path(['contact', 'lastName'], root),
      fullName: R.path(['contact', 'fullName'], root),
      phoneNumber: R.path(['contact', 'phoneNumber'], root),
      emailAddress: R.path(['contact', 'emailAddress'], root),
    }),
    notes: R.pathOr('', ['notes']),
    price: root => ({
      original: R.path(['pricing', 'total'], root),
      retail: R.path(['pricing', 'total'], root),
      currencyPrecision: R.path(['pricing', 'currencyPrecision'], root),
      currency: R.path(['pricing', 'currency'], root),
    }),
    cancelPolicy: root => {
      const cancellationCutoff = R.pathOr('', ['option', 'cancellationCutoff'], root);
      if (cancellationCutoff) return `Cancel before ${cancellationCutoff} of departure time.`;
      return '';
    },
    optionId: R.path(['optionId']),
    optionName: ({ option }) => option ? option.internalName : '',
    resellerReference: R.propOr('', 'resellerReference'),
    // TODO
    publicUrl: R.prop('confirmation_url'),
    privateUrl: root => {
      if (root.supplierShortName) {
        return `https://${root.supplierShortName}.zaui.net/modules/tours/tourItinerary.php?bookingid=${root.id}`
      }
    },
    pickupRequested: R.prop('pickupRequested'),
    pickupPointId: R.prop('pickupPointId'),
    pickupPoint: root => {
      const pickupPoint = R.path(['pickupPoint'], root);
      if (!pickupPoint) return null;
      return {
        ...pickupPoint,
        postal: pickupPoint.postal_code,
      };
    },
  },
};


const translateBooking = async ({ rootValue, typeDefs, query }) => {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });
  const retVal = await graphql({
    schema,
    rootValue,
    source: query,
  });
  if (retVal.errors) throw new Error(retVal.errors);
  return retVal.data;
};

module.exports = {
  translateBooking,
};
