"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.extendSchema = extendSchema;
exports.extendSchemaImpl = extendSchemaImpl;
exports.getDescription = getDescription;

var _objectValues = _interopRequireDefault(require("../polyfills/objectValues"));

var _keyMap = _interopRequireDefault(require("../jsutils/keyMap"));

var _inspect = _interopRequireDefault(require("../jsutils/inspect"));

var _mapValue = _interopRequireDefault(require("../jsutils/mapValue"));

var _invariant = _interopRequireDefault(require("../jsutils/invariant"));

var _devAssert = _interopRequireDefault(require("../jsutils/devAssert"));

var _kinds = require("../language/kinds");

var _tokenKind = require("../language/tokenKind");

var _blockString = require("../language/blockString");

var _predicates = require("../language/predicates");

var _validate = require("../validation/validate");

var _values = require("../execution/values");

var _scalars = require("../type/scalars");

var _introspection = require("../type/introspection");

var _directives = require("../type/directives");

var _schema = require("../type/schema");

var _definition = require("../type/definition");

var _valueFromAST = require("./valueFromAST");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(source, true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(source).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

/**
 * Produces a new schema given an existing schema and a document which may
 * contain GraphQL type extensions and definitions. The original schema will
 * remain unaltered.
 *
 * Because a schema represents a graph of references, a schema cannot be
 * extended without effectively making an entire copy. We do not know until it's
 * too late if subgraphs remain unchanged.
 *
 * This algorithm copies the provided schema, applying extensions while
 * producing the copy. The original schema remains unaltered.
 *
 * Accepts options as a third argument:
 *
 *    - commentDescriptions:
 *        Provide true to use preceding comments as the description.
 *
 */
function extendSchema(schema, documentAST, options) {
  (0, _schema.assertSchema)(schema);
  documentAST && documentAST.kind === _kinds.Kind.DOCUMENT || (0, _devAssert.default)(0, 'Must provide valid Document AST.');

  if (!options || !(options.assumeValid || options.assumeValidSDL)) {
    (0, _validate.assertValidSDLExtension)(documentAST, schema);
  }

  var schemaConfig = schema.toConfig();
  var extendedConfig = extendSchemaImpl(schemaConfig, documentAST, options);
  return schemaConfig === extendedConfig ? schema : new _schema.GraphQLSchema(extendedConfig);
}
/**
 * @internal
 */


function extendSchemaImpl(schemaConfig, documentAST, options) {
  // Collect the type definitions and extensions found in the document.
  var typeDefs = [];
  var typeExtensionsMap = Object.create(null); // New directives and types are separate because a directives and types can
  // have the same name. For example, a type named "skip".

  var directiveDefs = [];
  var schemaDef; // Schema extensions are collected which may add additional operation types.

  var schemaExtensions = [];

  for (var _i2 = 0, _documentAST$definiti2 = documentAST.definitions; _i2 < _documentAST$definiti2.length; _i2++) {
    var def = _documentAST$definiti2[_i2];

    if (def.kind === _kinds.Kind.SCHEMA_DEFINITION) {
      schemaDef = def;
    } else if (def.kind === _kinds.Kind.SCHEMA_EXTENSION) {
      schemaExtensions.push(def);
    } else if ((0, _predicates.isTypeDefinitionNode)(def)) {
      typeDefs.push(def);
    } else if ((0, _predicates.isTypeExtensionNode)(def)) {
      var extendedTypeName = def.name.value;
      var existingTypeExtensions = typeExtensionsMap[extendedTypeName];
      typeExtensionsMap[extendedTypeName] = existingTypeExtensions ? existingTypeExtensions.concat([def]) : [def];
    } else if (def.kind === _kinds.Kind.DIRECTIVE_DEFINITION) {
      directiveDefs.push(def);
    }
  } // If this document contains no new types, extensions, or directives then
  // return the same unmodified GraphQLSchema instance.


  if (Object.keys(typeExtensionsMap).length === 0 && typeDefs.length === 0 && directiveDefs.length === 0 && schemaExtensions.length === 0 && !schemaDef) {
    return schemaConfig;
  }

  var typeMap = Object.create(null);

  for (var _i4 = 0; _i4 < typeDefs.length; _i4++) {
    var typeNode = typeDefs[_i4];
    var name = typeNode.name.value;
    typeMap[name] = stdTypeMap[name] || buildType(typeNode);
  }

  for (var _i6 = 0, _schemaConfig$types2 = schemaConfig.types; _i6 < _schemaConfig$types2.length; _i6++) {
    var existingType = _schemaConfig$types2[_i6];
    typeMap[existingType.name] = extendNamedType(existingType);
  }

  var operationTypes = _objectSpread({
    // Get the extended root operation types.
    query: schemaConfig.query && replaceNamedType(schemaConfig.query),
    mutation: schemaConfig.mutation && replaceNamedType(schemaConfig.mutation),
    subscription: schemaConfig.subscription && replaceNamedType(schemaConfig.subscription)
  }, schemaDef && getOperationTypes([schemaDef]), {}, getOperationTypes(schemaExtensions)); // Then produce and return a Schema config with these types.


  return _objectSpread({}, operationTypes, {
    types: (0, _objectValues.default)(typeMap),
    directives: [].concat(schemaConfig.directives.map(replaceDirective), directiveDefs.map(buildDirective)),
    extensions: undefined,
    astNode: schemaDef || schemaConfig.astNode,
    extensionASTNodes: concatMaybeArrays(schemaConfig.extensionASTNodes, schemaExtensions),
    assumeValid: options && options.assumeValid || false
  }); // Below are functions used for producing this schema that have closed over
  // this scope and have access to the schema, cache, and newly defined types.

  function replaceType(type) {
    if ((0, _definition.isListType)(type)) {
      return new _definition.GraphQLList(replaceType(type.ofType));
    } else if ((0, _definition.isNonNullType)(type)) {
      return new _definition.GraphQLNonNull(replaceType(type.ofType));
    }

    return replaceNamedType(type);
  }

  function replaceNamedType(type) {
    // Note: While this could make early assertions to get the correctly
    // typed values, that would throw immediately while type system
    // validation with validateSchema() will produce more actionable results.
    return typeMap[type.name];
  }

  function replaceDirective(directive) {
    var config = directive.toConfig();
    return new _directives.GraphQLDirective(_objectSpread({}, config, {
      args: (0, _mapValue.default)(config.args, extendArg)
    }));
  }

  function extendNamedType(type) {
    if ((0, _introspection.isIntrospectionType)(type) || (0, _scalars.isSpecifiedScalarType)(type)) {
      // Builtin types are not extended.
      return type;
    } else if ((0, _definition.isScalarType)(type)) {
      return extendScalarType(type);
    } else if ((0, _definition.isObjectType)(type)) {
      return extendObjectType(type);
    } else if ((0, _definition.isInterfaceType)(type)) {
      return extendInterfaceType(type);
    } else if ((0, _definition.isUnionType)(type)) {
      return extendUnionType(type);
    } else if ((0, _definition.isEnumType)(type)) {
      return extendEnumType(type);
    } else if ((0, _definition.isInputObjectType)(type)) {
      return extendInputObjectType(type);
    } // Not reachable. All possible types have been considered.


    /* istanbul ignore next */
    (0, _invariant.default)(false, 'Unexpected type: ' + (0, _inspect.default)(type));
  }

  function extendInputObjectType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[config.name] || [];
    return new _definition.GraphQLInputObjectType(_objectSpread({}, config, {
      fields: function fields() {
        return _objectSpread({}, (0, _mapValue.default)(config.fields, function (field) {
          return _objectSpread({}, field, {
            type: replaceType(field.type)
          });
        }), {}, buildInputFieldMap(extensions));
      },
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendEnumType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[type.name] || [];
    return new _definition.GraphQLEnumType(_objectSpread({}, config, {
      values: _objectSpread({}, config.values, {}, buildEnumValueMap(extensions)),
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendScalarType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[config.name] || [];
    return new _definition.GraphQLScalarType(_objectSpread({}, config, {
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendObjectType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[config.name] || [];
    return new _definition.GraphQLObjectType(_objectSpread({}, config, {
      interfaces: function interfaces() {
        return [].concat(type.getInterfaces().map(replaceNamedType), buildInterfaces(extensions));
      },
      fields: function fields() {
        return _objectSpread({}, (0, _mapValue.default)(config.fields, extendField), {}, buildFieldMap(extensions));
      },
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendInterfaceType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[config.name] || [];
    return new _definition.GraphQLInterfaceType(_objectSpread({}, config, {
      interfaces: function interfaces() {
        return [].concat(type.getInterfaces().map(replaceNamedType), buildInterfaces(extensions));
      },
      fields: function fields() {
        return _objectSpread({}, (0, _mapValue.default)(config.fields, extendField), {}, buildFieldMap(extensions));
      },
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendUnionType(type) {
    var config = type.toConfig();
    var extensions = typeExtensionsMap[config.name] || [];
    return new _definition.GraphQLUnionType(_objectSpread({}, config, {
      types: function types() {
        return [].concat(type.getTypes().map(replaceNamedType), buildUnionTypes(extensions));
      },
      extensionASTNodes: concatMaybeArrays(config.extensionASTNodes, extensions)
    }));
  }

  function extendField(field) {
    return _objectSpread({}, field, {
      type: replaceType(field.type),
      args: (0, _mapValue.default)(field.args, extendArg)
    });
  }

  function extendArg(arg) {
    return _objectSpread({}, arg, {
      type: replaceType(arg.type)
    });
  }

  function getOperationTypes(nodes) {
    // Note: While this could make early assertions to get the correctly
    // typed values below, that would throw immediately while type system
    // validation with validateSchema() will produce more actionable results.
    var opTypes = {};

    for (var _i8 = 0; _i8 < nodes.length; _i8++) {
      var node = nodes[_i8];

      if (node.operationTypes != null) {
        for (var _i10 = 0, _node$operationTypes2 = node.operationTypes; _i10 < _node$operationTypes2.length; _i10++) {
          var operationType = _node$operationTypes2[_i10];
          opTypes[operationType.operation] = getNamedType(operationType.type);
        }
      }
    }

    return opTypes;
  }

  function getNamedType(node) {
    var name = node.name.value;
    var type = stdTypeMap[name] || typeMap[name];

    if (type === undefined) {
      throw new Error("Unknown type: \"".concat(name, "\"."));
    }

    return type;
  }

  function getWrappedType(node) {
    if (node.kind === _kinds.Kind.LIST_TYPE) {
      return new _definition.GraphQLList(getWrappedType(node.type));
    }

    if (node.kind === _kinds.Kind.NON_NULL_TYPE) {
      return new _definition.GraphQLNonNull(getWrappedType(node.type));
    }

    return getNamedType(node);
  }

  function buildDirective(node) {
    var locations = node.locations.map(function (_ref) {
      var value = _ref.value;
      return value;
    });
    return new _directives.GraphQLDirective({
      name: node.name.value,
      description: getDescription(node, options),
      locations: locations,
      isRepeatable: node.repeatable,
      args: buildArgumentMap(node.arguments),
      astNode: node
    });
  }

  function buildFieldMap(nodes) {
    var fieldConfigMap = Object.create(null);

    for (var _i12 = 0; _i12 < nodes.length; _i12++) {
      var node = nodes[_i12];

      if (node.fields != null) {
        for (var _i14 = 0, _node$fields2 = node.fields; _i14 < _node$fields2.length; _i14++) {
          var field = _node$fields2[_i14];
          fieldConfigMap[field.name.value] = {
            // Note: While this could make assertions to get the correctly typed
            // value, that would throw immediately while type system validation
            // with validateSchema() will produce more actionable results.
            type: getWrappedType(field.type),
            description: getDescription(field, options),
            args: buildArgumentMap(field.arguments),
            deprecationReason: getDeprecationReason(field),
            astNode: field
          };
        }
      }
    }

    return fieldConfigMap;
  }

  function buildArgumentMap(args) {
    var argConfigMap = Object.create(null);

    if (args != null) {
      for (var _i16 = 0; _i16 < args.length; _i16++) {
        var arg = args[_i16];
        // Note: While this could make assertions to get the correctly typed
        // value, that would throw immediately while type system validation
        // with validateSchema() will produce more actionable results.
        var type = getWrappedType(arg.type);
        argConfigMap[arg.name.value] = {
          type: type,
          description: getDescription(arg, options),
          defaultValue: (0, _valueFromAST.valueFromAST)(arg.defaultValue, type),
          astNode: arg
        };
      }
    }

    return argConfigMap;
  }

  function buildInputFieldMap(nodes) {
    var inputFieldMap = Object.create(null);

    for (var _i18 = 0; _i18 < nodes.length; _i18++) {
      var node = nodes[_i18];

      if (node.fields != null) {
        for (var _i20 = 0, _node$fields4 = node.fields; _i20 < _node$fields4.length; _i20++) {
          var field = _node$fields4[_i20];
          // Note: While this could make assertions to get the correctly typed
          // value, that would throw immediately while type system validation
          // with validateSchema() will produce more actionable results.
          var type = getWrappedType(field.type);
          inputFieldMap[field.name.value] = {
            type: type,
            description: getDescription(field, options),
            defaultValue: (0, _valueFromAST.valueFromAST)(field.defaultValue, type),
            astNode: field
          };
        }
      }
    }

    return inputFieldMap;
  }

  function buildEnumValueMap(nodes) {
    var enumValueMap = Object.create(null);

    for (var _i22 = 0; _i22 < nodes.length; _i22++) {
      var node = nodes[_i22];

      if (node.values != null) {
        for (var _i24 = 0, _node$values2 = node.values; _i24 < _node$values2.length; _i24++) {
          var value = _node$values2[_i24];
          enumValueMap[value.name.value] = {
            description: getDescription(value, options),
            deprecationReason: getDeprecationReason(value),
            astNode: value
          };
        }
      }
    }

    return enumValueMap;
  }

  function buildInterfaces(nodes) {
    var interfaces = [];

    for (var _i26 = 0; _i26 < nodes.length; _i26++) {
      var node = nodes[_i26];

      if (node.interfaces != null) {
        for (var _i28 = 0, _node$interfaces2 = node.interfaces; _i28 < _node$interfaces2.length; _i28++) {
          var type = _node$interfaces2[_i28];
          // Note: While this could make assertions to get the correctly typed
          // values below, that would throw immediately while type system
          // validation with validateSchema() will produce more actionable
          // results.
          interfaces.push(getNamedType(type));
        }
      }
    }

    return interfaces;
  }

  function buildUnionTypes(nodes) {
    var types = [];

    for (var _i30 = 0; _i30 < nodes.length; _i30++) {
      var node = nodes[_i30];

      if (node.types != null) {
        for (var _i32 = 0, _node$types2 = node.types; _i32 < _node$types2.length; _i32++) {
          var type = _node$types2[_i32];
          // Note: While this could make assertions to get the correctly typed
          // values below, that would throw immediately while type system
          // validation with validateSchema() will produce more actionable
          // results.
          types.push(getNamedType(type));
        }
      }
    }

    return types;
  }

  function buildType(astNode) {
    var name = astNode.name.value;
    var description = getDescription(astNode, options);
    var extensionNodes = typeExtensionsMap[name] || [];

    switch (astNode.kind) {
      case _kinds.Kind.OBJECT_TYPE_DEFINITION:
        {
          var extensionASTNodes = extensionNodes;
          var allNodes = [astNode].concat(extensionASTNodes);
          return new _definition.GraphQLObjectType({
            name: name,
            description: description,
            interfaces: function interfaces() {
              return buildInterfaces(allNodes);
            },
            fields: function fields() {
              return buildFieldMap(allNodes);
            },
            astNode: astNode,
            extensionASTNodes: extensionASTNodes
          });
        }

      case _kinds.Kind.INTERFACE_TYPE_DEFINITION:
        {
          var _extensionASTNodes = extensionNodes;

          var _allNodes = [astNode].concat(_extensionASTNodes);

          return new _definition.GraphQLInterfaceType({
            name: name,
            description: description,
            interfaces: function interfaces() {
              return buildInterfaces(_allNodes);
            },
            fields: function fields() {
              return buildFieldMap(_allNodes);
            },
            astNode: astNode,
            extensionASTNodes: _extensionASTNodes
          });
        }

      case _kinds.Kind.ENUM_TYPE_DEFINITION:
        {
          var _extensionASTNodes2 = extensionNodes;

          var _allNodes2 = [astNode].concat(_extensionASTNodes2);

          return new _definition.GraphQLEnumType({
            name: name,
            description: description,
            values: buildEnumValueMap(_allNodes2),
            astNode: astNode,
            extensionASTNodes: _extensionASTNodes2
          });
        }

      case _kinds.Kind.UNION_TYPE_DEFINITION:
        {
          var _extensionASTNodes3 = extensionNodes;

          var _allNodes3 = [astNode].concat(_extensionASTNodes3);

          return new _definition.GraphQLUnionType({
            name: name,
            description: description,
            types: function types() {
              return buildUnionTypes(_allNodes3);
            },
            astNode: astNode,
            extensionASTNodes: _extensionASTNodes3
          });
        }

      case _kinds.Kind.SCALAR_TYPE_DEFINITION:
        {
          var _extensionASTNodes4 = extensionNodes;
          return new _definition.GraphQLScalarType({
            name: name,
            description: description,
            astNode: astNode,
            extensionASTNodes: _extensionASTNodes4
          });
        }

      case _kinds.Kind.INPUT_OBJECT_TYPE_DEFINITION:
        {
          var _extensionASTNodes5 = extensionNodes;

          var _allNodes4 = [astNode].concat(_extensionASTNodes5);

          return new _definition.GraphQLInputObjectType({
            name: name,
            description: description,
            fields: function fields() {
              return buildInputFieldMap(_allNodes4);
            },
            astNode: astNode,
            extensionASTNodes: _extensionASTNodes5
          });
        }
    } // Not reachable. All possible type definition nodes have been considered.


    /* istanbul ignore next */
    (0, _invariant.default)(false, 'Unexpected type definition node: ' + (0, _inspect.default)(astNode));
  }
}

function concatMaybeArrays() {
  // eslint-disable-next-line no-undef-init
  var result = undefined;

  for (var _len = arguments.length, arrays = new Array(_len), _key = 0; _key < _len; _key++) {
    arrays[_key] = arguments[_key];
  }

  for (var _i34 = 0; _i34 < arrays.length; _i34++) {
    var maybeArray = arrays[_i34];

    if (maybeArray) {
      result = result === undefined ? maybeArray : result.concat(maybeArray);
    }
  }

  return result;
}

var stdTypeMap = (0, _keyMap.default)(_scalars.specifiedScalarTypes.concat(_introspection.introspectionTypes), function (type) {
  return type.name;
});
/**
 * Given a field or enum value node, returns the string value for the
 * deprecation reason.
 */

function getDeprecationReason(node) {
  var deprecated = (0, _values.getDirectiveValues)(_directives.GraphQLDeprecatedDirective, node);
  return deprecated && deprecated.reason;
}
/**
 * Given an ast node, returns its string description.
 * @deprecated: provided to ease adoption and will be removed in v16.
 *
 * Accepts options as a second argument:
 *
 *    - commentDescriptions:
 *        Provide true to use preceding comments as the description.
 *
 */


function getDescription(node, options) {
  if (node.description) {
    return node.description.value;
  }

  if (options && options.commentDescriptions) {
    var rawValue = getLeadingCommentBlock(node);

    if (rawValue !== undefined) {
      return (0, _blockString.dedentBlockStringValue)('\n' + rawValue);
    }
  }
}

function getLeadingCommentBlock(node) {
  var loc = node.loc;

  if (!loc) {
    return;
  }

  var comments = [];
  var token = loc.startToken.prev;

  while (token && token.kind === _tokenKind.TokenKind.COMMENT && token.next && token.prev && token.line + 1 === token.next.line && token.line !== token.prev.line) {
    var value = String(token.value);
    comments.push(value);
    token = token.prev;
  }

  return comments.length > 0 ? comments.reverse().join('\n') : undefined;
}