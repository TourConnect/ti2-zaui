const { makeExecutableSchema } = require('@graphql-tools/schema');
const R = require('ramda');
const { graphql } = require('graphql');


function extractAndSortNumbers(str) {
  const regex = /\d+/g;
  const matches = str.match(regex);
  if (!matches) return null;

  return matches.map(Number).sort((a, b) => a - b);
}

const resolvers = {
  Query: {
    productId: R.path(['id']),
    productName: R.path(['internalName']),
    availableCurrencies: root => {
      const result = R.propOr([], 'availableCurrencies', root);
      return R.uniq(result);
    },
    defaultCurrency: R.path(['defaultCurrency']),
    options: R.propOr([], 'options'),
  },
  Option: {
    optionId: R.prop('id'),
    optionName: R.prop('internalName'),
    units: R.propOr([], ['units']),
  },
  Unit: {
    unitId: R.path(['id']),
    unitName: root =>  {
      // user (prince of whales) prefer to use "reference" instead of "internalName"
      // because internalName is "STUDENT", and they prefer to use "Youth"
      if (root.reference) {
        if (root.reference.includes('(')) {
          return root.reference.split('(')[0].trim();
        }
        return root.reference;
      }
      return R.pathOr('', ['internalName'], root);
    },
    subtitle: R.pathOr('', ['note']),
    type: R.prop('type'),
    pricing: root => R.propOr([], 'pricingFrom', root).map(p => ({
      original: R.path(['subtotal'], p),
      retail: R.path(['subtotal'], p),
      currencyPrecision: R.path(['currencyPrecision'], p),
      currency: R.path(['currency'], p),
    })),
    restrictions: root => {
      if (!root.restrictions) return {};
      if (root.restrictions.minAge === 0 && root.restrictions.maxAge === 99) {
        if (root.reference && extractAndSortNumbers(root.reference)) {
          const [minAge, maxAge] = extractAndSortNumbers(root.reference);
          return {
            ...root.restrictions,
            minAge: minAge || 0,
            maxAge: maxAge || 99,
          }
        }
      }
      return root.restrictions;
    },
  },
};

const translateProduct = async ({
  rootValue,
  typeDefs,
  query,
}) => {
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
  translateProduct,
};
