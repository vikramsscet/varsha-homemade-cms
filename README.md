# Varsha Homemade CMS

A Node.js + Express backend for managing a homemade products catalog, including categories, products, and product image uploads. The project uses Prisma ORM with PostgreSQL and exposes a Swagger API documentation UI for local development.

## Features

- Category management with CRUD endpoints
- Product management with validation and metadata support
- Product image upload support for JPEG, PNG, and WebP files
- S3-compatible storage integration via Supabase Storage
- Prisma-based data layer with UUID primary keys and structured indexes
- Health check endpoint for service and database monitoring
- Swagger docs available in the browser

## Tech Stack

- Node.js
- Express
- Prisma ORM
- PostgreSQL
- AWS S3 SDK (for object storage)
- Swagger UI / OpenAPI
- Multer for multipart uploads

## Project Structure

```text
.
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── app.js
│   ├── server.js
│   ├── categories/
│   ├── config/
│   ├── controllers/
│   ├── middlewares/
│   ├── products/
│   ├── routes/
│   └── services/
├── package.json
├── README.md
└── .env
```

## Prerequisites

Before running the project, make sure you have:

- Node.js 18+ installed
- PostgreSQL database running
- An S3-compatible storage bucket configured (for image uploads)
- Environment variables set in a `.env` file

## Environment Variables

Create a `.env` file in the project root with values similar to:

```env
NODE_ENV=development
PORT=3000
API_PREFIX=/api/v1
APP_URL=http://localhost:3000

DATABASE_URL="postgresql://username:password@localhost:5432/varsha_homemade_cms?schema=public"

SUPABASE_S3_ENDPOINT="https://your-project.supabase.co/storage/v1/s3"
SUPABASE_S3_REGION="us-east-1"
SUPABASE_S3_ACCESS_KEY_ID="your-access-key"
SUPABASE_S3_SECRET_ACCESS_KEY="your-secret-key"
SUPABASE_STORAGE_BUCKET="product-images"
SUPABASE_STORAGE_PUBLIC_URL="https://your-project.supabase.co/storage/v1/object/public/product-images"

MAX_IMAGE_SIZE=5242880
```

## Installation

```bash
npm install
```

## Database Setup

Generate Prisma client and apply migrations:

```bash
npx prisma generate
npx prisma migrate dev
```

If you want to open Prisma Studio:

```bash
npm run prisma:studio
```

## Run the Server

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

The API will run at:

```text
http://localhost:3000
```

## API Endpoints

### Health

```http
GET /api/v1/health
```

### Categories

```http
GET    /api/v1/categories
POST   /api/v1/categories
GET    /api/v1/categories/:id
PATCH  /api/v1/categories/:id
DELETE /api/v1/categories/:id
```

### Products

```http
GET    /api/v1/products
POST   /api/v1/products
GET    /api/v1/products/:id
PATCH  /api/v1/products/:id
DELETE /api/v1/products/:id
```

### Product Images

```http
POST   /api/v1/products/:productId/images
GET    /api/v1/products/:productId/images
DELETE /api/v1/products/:productId/images/:imageId
```

## API Documentation

Swagger UI is available at:

```text
http://localhost:3000/api-docs
```

Raw OpenAPI JSON is available at:

```text
http://localhost:3000/api-docs.json
```

## Notes

- Product descriptions are stored as JSON objects.
- Slugs are normalized to URL-safe values.
- Product images must be valid JPEG, PNG, or WebP files under 5 MB by default.
- Storage keys are generated automatically per product and uploaded file.

## License

This project is currently intended for internal use and does not include a formal open-source license.
