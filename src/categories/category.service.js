const prisma = require('../config/database');

const createCategoryError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const validateId = (id) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw createCategoryError(400, 'INVALID_CATEGORY_ID', 'Category ID must be a valid UUID');
  }
};

const validateName = (name) => {
  if (typeof name !== 'string' || name.trim() === '') {
    throw createCategoryError(400, 'INVALID_CATEGORY', 'Category name is required');
  }

  return name.trim();
};

const validateSlug = (slug) => {
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw createCategoryError(400, 'INVALID_CATEGORY', 'Category slug is required');
  }

  const normalizedSlug = slug.trim().toLowerCase().replace(/\s+/g, '-');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) {
    throw createCategoryError(400, 'INVALID_CATEGORY', 'Category slug must contain only URL-safe characters');
  }

  return normalizedSlug;
};

const validateDisplayOrder = (displayOrder) => {
  if (!Number.isInteger(displayOrder) || displayOrder < 0) {
    throw createCategoryError(400, 'INVALID_CATEGORY', 'Category displayOrder must be an integer greater than or equal to 0');
  }

  return displayOrder;
};

const validateIsActive = (isActive) => {
  if (typeof isActive !== 'boolean') {
    throw createCategoryError(400, 'INVALID_CATEGORY', 'Category isActive must be a boolean');
  }

  return isActive;
};

const validateDescription = (description) => {
  if (description !== null && typeof description !== 'string') {
    throw createCategoryError(400, 'INVALID_CATEGORY', 'Category description must be a string or null');
  }

  return description === null ? null : description.trim();
};

const handlePrismaError = (error) => {
  if (error.code === 'P2002') {
    throw createCategoryError(409, 'CATEGORY_SLUG_ALREADY_EXISTS', 'A category with this slug already exists');
  }

  throw error;
};

const createCategory = async (input) => {
  const data = {
    name: validateName(input.name),
    slug: validateSlug(input.slug),
    description: input.description === undefined ? null : validateDescription(input.description),
    displayOrder: input.displayOrder === undefined ? 0 : validateDisplayOrder(input.displayOrder),
    isActive: input.isActive === undefined ? true : validateIsActive(input.isActive)
  };

  try {
    return await prisma.category.create({ data });
  } catch (error) {
    handlePrismaError(error);
  }
};

const getCategories = async ({ isActive } = {}) => {
  let activeFilter;
  if (isActive !== undefined) {
    if (isActive !== 'true' && isActive !== 'false') {
      throw createCategoryError(400, 'INVALID_CATEGORY_FILTER', 'isActive must be true or false');
    }

    activeFilter = isActive === 'true';
  }

  const where = activeFilter === undefined ? undefined : { isActive: activeFilter };

  return prisma.category.findMany({
    where,
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }]
  });
};

const getCategoryById = async (id) => {
  validateId(id);

  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) {
    throw createCategoryError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
  }

  return category;
};

const updateCategory = async (id, input) => {
  validateId(id);

  const immutableFields = ['id', 'createdAt', 'updatedAt'];
  if (immutableFields.some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
    throw createCategoryError(400, 'INVALID_CATEGORY', 'Category identity and timestamps cannot be updated');
  }

  const data = {};
  if (Object.prototype.hasOwnProperty.call(input, 'name')) data.name = validateName(input.name);
  if (Object.prototype.hasOwnProperty.call(input, 'slug')) data.slug = validateSlug(input.slug);
  if (Object.prototype.hasOwnProperty.call(input, 'description')) data.description = validateDescription(input.description);
  if (Object.prototype.hasOwnProperty.call(input, 'displayOrder')) data.displayOrder = validateDisplayOrder(input.displayOrder);
  if (Object.prototype.hasOwnProperty.call(input, 'isActive')) data.isActive = validateIsActive(input.isActive);

  if (Object.keys(data).length === 0) {
    throw createCategoryError(400, 'INVALID_CATEGORY', 'At least one category field is required');
  }

  try {
    return await prisma.category.update({ where: { id }, data });
  } catch (error) {
    if (error.code === 'P2025') {
      throw createCategoryError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    }

    handlePrismaError(error);
  }
};

const deleteCategory = async (id) => {
  validateId(id);

  try {
    await prisma.category.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2025') {
      throw createCategoryError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    }

    throw error;
  }
};

module.exports = {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory
};
