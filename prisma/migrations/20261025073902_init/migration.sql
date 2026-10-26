-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('AUTOMOTIVE_DEALERSHIP', 'HOTEL', 'RESTAURANT', 'OTHER');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('GROUP', 'BUSINESS_UNIT', 'BRANCH', 'SELF');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'ON_LEAVE', 'HALF_DAY');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VehicleStockStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'BOOKING_CONFIRMED', 'AWAITING_REGISTRATION', 'ACCESSORIES_PENDING', 'READY_FOR_DELIVERY', 'DELIVERED', 'TRANSFERRED', 'RETURNED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'TEST_RIDE_SCHEDULED', 'QUOTED', 'BOOKED', 'LOST');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'FINANCE_PENDING', 'AWAITING_REGISTRATION', 'ACCESSORIES_PENDING', 'READY_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('SPARE_PART', 'ACCESSORY', 'CONSUMABLE', 'WARRANTY_REPLACEMENT');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN_TO_SUPPLIER', 'CUSTOMER_RETURN', 'DAMAGED', 'RESERVE', 'RELEASE');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceJobStatus" AS ENUM ('RECEIVED', 'INSPECTION', 'AWAITING_APPROVAL', 'APPROVED', 'PARTS_PENDING', 'IN_REPAIR', 'QUALITY_CHECK', 'FINAL_BILLING', 'READY_FOR_DELIVERY', 'DELIVERED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('PERIODIC_SERVICE', 'FREE_SERVICE', 'GENERAL_REPAIR', 'ACCIDENT_REPAIR', 'WARRANTY_REPAIR', 'BREAKDOWN', 'INSPECTION_ONLY');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('ADVISOR', 'EXAMINER', 'MECHANIC', 'INSPECTOR', 'BILLING');

-- CreateEnum
CREATE TYPE "RepairTaskStatus" AS ENUM ('PENDING', 'READY', 'IN_PROGRESS', 'PAUSED', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PartRequestStatus" AS ENUM ('REQUESTED', 'RESERVED', 'PICKING', 'PICKED', 'ISSUED', 'UNAVAILABLE', 'AWAITING_PROCUREMENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'FINALIZED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WarrantyClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SETTLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED_NO_PROVIDER');

-- CreateTable
CREATE TABLE "BusinessGroup" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessUnit" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "BusinessType" NOT NULL,
    "brand" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BusinessUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "businessUnitId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "stateCode" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "workdayStart" TEXT NOT NULL DEFAULT '09:30',
    "workdayEnd" TEXT NOT NULL DEFAULT '18:30',
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "serviceBays" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "userType" "UserType" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMPTZ(3),
    "passwordChangedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "ipAddress" TEXT,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemFlag" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SystemFlag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "RoleScope" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "UserBranchAssignment" (
    "userId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBranchAssignment_pkey" PRIMARY KEY ("userId","branchId")
);

-- CreateTable
CREATE TABLE "UserBusinessUnitAssignment" (
    "userId" UUID NOT NULL,
    "businessUnitId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBusinessUnitAssignment_pkey" PRIMARY KEY ("userId","businessUnitId")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "userId" UUID,
    "branchId" UUID NOT NULL,
    "departmentId" UUID,
    "fullName" TEXT NOT NULL,
    "workEmail" TEXT,
    "workPhone" TEXT,
    "designation" TEXT NOT NULL,
    "joiningDate" DATE NOT NULL,
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "reportingManagerId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "clockInAt" TIMESTAMPTZ(3),
    "clockOutAt" TIMESTAMPTZ(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "onBreakSince" TIMESTAMPTZ(3),
    "workedMinutes" INTEGER,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "isEarlyDeparture" BOOLEAN NOT NULL DEFAULT false,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "verification" TEXT NOT NULL DEFAULT 'SELF_REPORTED_UNVERIFIED',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceCorrection" (
    "id" UUID NOT NULL,
    "attendanceId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "requestedClockIn" TIMESTAMPTZ(3),
    "requestedClockOut" TIMESTAMPTZ(3),
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "leaveType" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTarget" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "targetValue" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "customerCode" TEXT NOT NULL,
    "userId" UUID,
    "createdAtBranchId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "stateCode" TEXT,
    "postalCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerConsent" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "capturedById" UUID,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CustomerConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDocument" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "identifierEncrypted" TEXT,
    "identifierMasked" TEXT,
    "fileId" UUID,
    "uploadedById" UUID NOT NULL,
    "retainUntil" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleModel" (
    "id" UUID NOT NULL,
    "businessUnitId" UUID NOT NULL,
    "brand" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT '',
    "category" TEXT,
    "engineCc" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "vehicleModelId" UUID NOT NULL,
    "modelYear" INTEGER NOT NULL,
    "colour" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "engineNumber" TEXT NOT NULL,
    "registrationStatus" TEXT NOT NULL DEFAULT 'NOT_REGISTERED',
    "registrationNumber" TEXT,
    "stockLocation" TEXT,
    "status" "VehicleStockStatus" NOT NULL DEFAULT 'AVAILABLE',
    "purchaseCost" DECIMAL(14,2) NOT NULL,
    "exShowroomPrice" DECIMAL(14,2) NOT NULL,
    "insuranceCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "registrationCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "accessoriesCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fittingCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "onRoadPrice" DECIMAL(14,2) NOT NULL,
    "accessories" JSONB NOT NULL DEFAULT '[]',
    "expectedDeliveryDate" DATE,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerVehicle" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "vehicleModelId" UUID,
    "modelName" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "vin" TEXT,
    "engineNumber" TEXT,
    "purchaseDate" DATE,
    "lastOdometer" INTEGER,
    "soldVehicleId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLead" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "customerId" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "interestedModelId" UUID,
    "source" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" UUID,
    "nextFollowUpAt" TIMESTAMPTZ(3),
    "lostReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SalesLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "outcome" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowroomTestRide" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "vehicleModelId" UUID NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "completedAt" TIMESTAMPTZ(3),
    "feedback" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShowroomTestRide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesQuotation" (
    "id" UUID NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "branchId" UUID NOT NULL,
    "leadId" UUID,
    "customerId" UUID,
    "vehicleModelId" UUID NOT NULL,
    "exShowroomPrice" DECIMAL(14,2) NOT NULL,
    "insuranceCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "registrationCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "accessoriesCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "validUntil" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleBooking" (
    "id" UUID NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "branchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "vehicleModelId" UUID NOT NULL,
    "vehicleId" UUID,
    "quotationId" UUID,
    "salesExecutiveId" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'RESERVED',
    "bookingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountApprovedById" UUID,
    "couponId" UUID,
    "financeStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "financier" TEXT,
    "insuranceProvider" TEXT,
    "insurancePolicyNumber" TEXT,
    "registrationStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "accessories" JSONB NOT NULL DEFAULT '[]',
    "deliveryScheduledAt" TIMESTAMPTZ(3),
    "deliveryChecklist" JSONB NOT NULL DEFAULT '{}',
    "deliveredAt" TIMESTAMPTZ(3),
    "customerAcknowledgedAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VehicleBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "businessUnitId" UUID NOT NULL,
    "branchId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "appliesTo" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" DECIMAL(14,2) NOT NULL,
    "maxDiscount" DECIMAL(14,2),
    "minOrderValue" DECIMAL(14,2),
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "usageLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "bookingId" UUID,
    "invoiceId" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "redeemedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "businessUnitId" UUID NOT NULL,
    "partNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "ItemCategory" NOT NULL,
    "manufacturer" TEXT,
    "defaultSupplierId" UUID,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "purchaseCost" DECIMAL(14,2) NOT NULL,
    "sellingPrice" DECIMAL(14,2) NOT NULL,
    "taxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "hsnCode" TEXT,
    "compatibleModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSerialized" BOOLEAN NOT NULL DEFAULT false,
    "warrantyMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLocation" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "minStockLevel" INTEGER NOT NULL DEFAULT 0,
    "reorderQuantity" INTEGER NOT NULL DEFAULT 0,
    "binLocation" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantityDelta" INTEGER NOT NULL DEFAULT 0,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "onHandAfter" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL,
    "unitCost" DECIMAL(14,2),
    "batchNumber" TEXT,
    "serialNumber" TEXT,
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "serviceJobId" UUID,
    "performedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sparePartRequestId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "businessUnitId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "addressLine" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "poNumber" TEXT NOT NULL,
    "branchId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedDate" DATE,
    "notes" TEXT,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" UUID NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "branchId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "purchaseOrderId" UUID,
    "locationId" UUID NOT NULL,
    "supplierInvoice" TEXT,
    "receivedById" UUID NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" UUID NOT NULL,
    "goodsReceiptId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "poLineId" UUID,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "batchNumber" TEXT,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" UUID NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "fromBranchId" UUID NOT NULL,
    "toBranchId" UUID NOT NULL,
    "fromLocationId" UUID NOT NULL,
    "toLocationId" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "requestedById" UUID NOT NULL,
    "approvedById" UUID,
    "dispatchedById" UUID,
    "dispatchedAt" TIMESTAMPTZ(3),
    "receivedById" UUID,
    "receivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "id" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAudit" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "startedById" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "StockAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAuditLine" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "systemQty" INTEGER NOT NULL,
    "countedQty" INTEGER NOT NULL,

    CONSTRAINT "StockAuditLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceJob" (
    "id" UUID NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "branchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerVehicleId" UUID NOT NULL,
    "serviceAdvisorId" UUID NOT NULL,
    "status" "ServiceJobStatus" NOT NULL DEFAULT 'RECEIVED',
    "serviceType" "ServiceType" NOT NULL,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "odometerIn" INTEGER NOT NULL,
    "odometerOut" INTEGER,
    "fuelLevel" TEXT NOT NULL,
    "reportedProblems" TEXT NOT NULL,
    "vehicleCondition" TEXT,
    "existingDamage" TEXT,
    "accessoriesReceived" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customerAcknowledgedAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedCompletionAt" TIMESTAMPTZ(3),
    "etaEarliest" TIMESTAMPTZ(3),
    "etaLatest" TIMESTAMPTZ(3),
    "etaConfidence" TEXT,
    "etaBreakdown" JSONB,
    "etaUpdatedAt" TIMESTAMPTZ(3),
    "readyAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ServiceJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceJobAssignment" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "AssignmentRole" NOT NULL,
    "assignedById" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ServiceJobAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionChecklistTemplate" (
    "id" UUID NOT NULL,
    "businessUnitId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InspectionChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceInspection" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "examinerId" UUID NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "findings" TEXT,
    "safetyCritical" BOOLEAN NOT NULL DEFAULT false,
    "customerSummary" TEXT,
    "internalNotes" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ServiceInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairTask" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "taskKey" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "RepairTaskStatus" NOT NULL DEFAULT 'PENDING',
    "origin" TEXT NOT NULL DEFAULT 'INITIAL',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isSafetyCritical" BOOLEAN NOT NULL DEFAULT false,
    "estimatedMinMinutes" INTEGER NOT NULL,
    "estimatedMaxMinutes" INTEGER NOT NULL,
    "labourCharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "assignedMechanicId" UUID,
    "startedAt" TIMESTAMPTZ(3),
    "lastResumedAt" TIMESTAMPTZ(3),
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMPTZ(3),
    "holdReason" TEXT,
    "reworkCount" INTEGER NOT NULL DEFAULT 0,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RepairTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairTaskDependency" (
    "taskId" UUID NOT NULL,
    "dependsOnTaskId" UUID NOT NULL,

    CONSTRAINT "RepairTaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnTaskId")
);

-- CreateTable
CREATE TABLE "RepairEstimate" (
    "id" UUID NOT NULL,
    "estimateNumber" TEXT NOT NULL,
    "jobId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INITIAL',
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "labourTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "partsTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approvedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expectedCompletionAt" TIMESTAMPTZ(3),
    "customerNote" TEXT,
    "preparedById" UUID NOT NULL,
    "sentAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateLineItem" (
    "id" UUID NOT NULL,
    "estimateId" UUID NOT NULL,
    "repairTaskId" UUID,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "inventoryItemId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "EstimateLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerApproval" (
    "id" UUID NOT NULL,
    "estimateId" UUID NOT NULL,
    "lineItemId" UUID,
    "decision" "ApprovalStatus" NOT NULL,
    "channel" TEXT NOT NULL,
    "decidedByUserId" UUID,
    "recordedByUserId" UUID,
    "notes" TEXT,
    "ipAddress" TEXT,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SparePartRequest" (
    "id" UUID NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "jobId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "repairTaskId" UUID,
    "estimateLineId" UUID,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" "PartRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" UUID NOT NULL,
    "assignedMechanicId" UUID,
    "availableAtRequest" INTEGER NOT NULL,
    "expectedAvailableAt" TIMESTAMPTZ(3),
    "procurementNote" TEXT,
    "purchaseOrderId" UUID,
    "transferId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SparePartRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SparePartIssue" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "issuedById" UUID NOT NULL,
    "receivedByMechanicId" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SparePartIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MechanicWorkLog" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "mechanicId" UUID NOT NULL,
    "fromStatus" "RepairTaskStatus" NOT NULL,
    "toStatus" "RepairTaskStatus" NOT NULL,
    "reason" TEXT,
    "minutesWorked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MechanicWorkLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityInspection" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "inspectorId" UUID NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "testRideRequired" BOOLEAN NOT NULL DEFAULT true,
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "returnedTaskIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "QualityInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRide" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "qualityInspectionId" UUID,
    "riderId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "odometerStart" INTEGER NOT NULL,
    "odometerEnd" INTEGER,
    "observations" TEXT,
    "result" TEXT NOT NULL DEFAULT 'IN_PROGRESS',

    CONSTRAINT "TestRide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceHandover" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "handedOverById" UUID NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientRelation" TEXT NOT NULL DEFAULT 'OWNER',
    "odometerOut" INTEGER NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "customerAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "handedOverAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePhoto" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "caption" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServicePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTimelineEvent" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerNote" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "nextExpectedAction" TEXT,
    "etaEarliest" TIMESTAMPTZ(3),
    "etaLatest" TIMESTAMPTZ(3),
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceTimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalActivityLog" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "jobId" UUID,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairDurationStandard" (
    "id" UUID NOT NULL,
    "businessUnitId" UUID NOT NULL,
    "branchId" UUID,
    "vehicleModelId" UUID,
    "taskKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minMinutes" INTEGER NOT NULL,
    "maxMinutes" INTEGER NOT NULL,
    "defaultLabour" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RepairDurationStandard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "invoiceNumber" TEXT,
    "branchId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "serviceJobId" UUID,
    "bookingId" UUID,
    "customerId" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "placeOfSupply" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igstTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balanceDue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "finalizedById" UUID,
    "finalizedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "inventoryItemId" UUID,
    "hsnSac" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxRatePercent" DECIMAL(5,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "receiptNumber" TEXT,
    "branchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "invoiceId" UUID,
    "bookingId" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "recordedById" UUID NOT NULL,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" UUID NOT NULL,
    "approvedById" UUID,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" UUID NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "incurredOn" DATE NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Warranty" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "vehicleId" UUID,
    "customerVehicleId" UUID,
    "inventoryItemId" UUID,
    "sparePartIssueId" UUID,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "terms" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warranty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyClaim" (
    "id" UUID NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "branchId" UUID NOT NULL,
    "businessUnitId" UUID NOT NULL,
    "warrantyId" UUID,
    "serviceJobId" UUID,
    "supplierId" UUID,
    "manufacturer" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "WarrantyClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "claimAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reimbursedAmount" DECIMAL(14,2),
    "decisionReason" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WarrantyClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyClaimDocument" (
    "claimId" UUID NOT NULL,
    "fileId" UUID NOT NULL,

    CONSTRAINT "WarrantyClaimDocument_pkey" PRIMARY KEY ("claimId","fileId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "branchId" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "businessUnitId" UUID,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "branchId" UUID,
    "customerId" UUID,
    "serviceJobId" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "serviceJobId" UUID,
    "type" TEXT NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedToId" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT,
    "notes" TEXT,
    "nextDueAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFeedback" (
    "id" UUID NOT NULL,
    "serviceJobId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comments" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "branchId" UUID,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSetting" (
    "id" UUID NOT NULL,
    "businessUnitId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BusinessSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchSetting" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BranchSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessGroup_code_key" ON "BusinessGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessUnit_code_key" ON "BusinessUnit"("code");

-- CreateIndex
CREATE INDEX "BusinessUnit_groupId_idx" ON "BusinessUnit"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE INDEX "Branch_businessUnitId_isActive_idx" ON "Branch"("businessUnitId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Department_branchId_name_key" ON "Department"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_branchId_date_key" ON "Holiday"("branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_userType_isActive_idx" ON "User"("userType", "isActive");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_identifier_createdAt_idx" ON "LoginAttempt"("identifier", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ipAddress_createdAt_idx" ON "LoginAttempt"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimitHit_bucket_createdAt_idx" ON "RateLimitHit"("bucket", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "UserBranchAssignment_branchId_idx" ON "UserBranchAssignment"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_branchId_status_idx" ON "Employee"("branchId", "status");

-- CreateIndex
CREATE INDEX "AttendanceRecord_branchId_workDate_idx" ON "AttendanceRecord"("branchId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_employeeId_workDate_key" ON "AttendanceRecord"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_branchId_status_idx" ON "LeaveRequest"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeTarget_employeeId_period_metric_key" ON "EmployeeTarget"("employeeId", "period", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerCode_key" ON "Customer"("customerCode");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_userId_key" ON "Customer"("userId");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_createdAtBranchId_idx" ON "Customer"("createdAtBranchId");

-- CreateIndex
CREATE INDEX "CustomerConsent_customerId_purpose_idx" ON "CustomerConsent"("customerId", "purpose");

-- CreateIndex
CREATE INDEX "CustomerDocument_customerId_idx" ON "CustomerDocument"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleModel_businessUnitId_name_variant_key" ON "VehicleModel"("businessUnitId", "name", "variant");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_vin_key" ON "Vehicle"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_engineNumber_key" ON "Vehicle"("engineNumber");

-- CreateIndex
CREATE INDEX "Vehicle_branchId_status_idx" ON "Vehicle"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerVehicle_registrationNumber_key" ON "CustomerVehicle"("registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerVehicle_vin_key" ON "CustomerVehicle"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerVehicle_soldVehicleId_key" ON "CustomerVehicle"("soldVehicleId");

-- CreateIndex
CREATE INDEX "CustomerVehicle_customerId_idx" ON "CustomerVehicle"("customerId");

-- CreateIndex
CREATE INDEX "SalesLead_branchId_status_idx" ON "SalesLead"("branchId", "status");

-- CreateIndex
CREATE INDEX "SalesLead_assignedToId_nextFollowUpAt_idx" ON "SalesLead"("assignedToId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesQuotation_quotationNumber_key" ON "SalesQuotation"("quotationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleBooking_bookingNumber_key" ON "VehicleBooking"("bookingNumber");

-- CreateIndex
CREATE INDEX "VehicleBooking_branchId_status_idx" ON "VehicleBooking"("branchId", "status");

-- CreateIndex
CREATE INDEX "VehicleBooking_customerId_idx" ON "VehicleBooking"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_customerId_idx" ON "CouponRedemption"("couponId", "customerId");

-- CreateIndex
CREATE INDEX "InventoryItem_businessUnitId_category_idx" ON "InventoryItem"("businessUnitId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_businessUnitId_partNumber_key" ON "InventoryItem"("businessUnitId", "partNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocation_branchId_code_key" ON "InventoryLocation"("branchId", "code");

-- CreateIndex
CREATE INDEX "InventoryBalance_branchId_idx" ON "InventoryBalance"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_itemId_locationId_key" ON "InventoryBalance"("itemId", "locationId");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_locationId_createdAt_idx" ON "StockMovement"("itemId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_branchId_createdAt_idx" ON "StockMovement"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_referenceType_referenceId_idx" ON "StockMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_sparePartRequestId_key" ON "StockReservation"("sparePartRequestId");

-- CreateIndex
CREATE INDEX "StockReservation_itemId_locationId_status_idx" ON "StockReservation"("itemId", "locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_businessUnitId_code_key" ON "Supplier"("businessUnitId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_branchId_status_idx" ON "PurchaseOrder"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_grnNumber_key" ON "GoodsReceipt"("grnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_transferNumber_key" ON "StockTransfer"("transferNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockAuditLine_auditId_itemId_key" ON "StockAuditLine"("auditId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceJob_jobNumber_key" ON "ServiceJob"("jobNumber");

-- CreateIndex
CREATE INDEX "ServiceJob_branchId_status_idx" ON "ServiceJob"("branchId", "status");

-- CreateIndex
CREATE INDEX "ServiceJob_customerId_idx" ON "ServiceJob"("customerId");

-- CreateIndex
CREATE INDEX "ServiceJob_customerVehicleId_idx" ON "ServiceJob"("customerVehicleId");

-- CreateIndex
CREATE INDEX "ServiceJob_branchId_receivedAt_idx" ON "ServiceJob"("branchId", "receivedAt");

-- CreateIndex
CREATE INDEX "ServiceJobAssignment_jobId_role_idx" ON "ServiceJobAssignment"("jobId", "role");

-- CreateIndex
CREATE INDEX "ServiceJobAssignment_userId_releasedAt_idx" ON "ServiceJobAssignment"("userId", "releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionChecklistTemplate_businessUnitId_kind_name_key" ON "InspectionChecklistTemplate"("businessUnitId", "kind", "name");

-- CreateIndex
CREATE INDEX "ServiceInspection_jobId_idx" ON "ServiceInspection"("jobId");

-- CreateIndex
CREATE INDEX "RepairTask_jobId_status_idx" ON "RepairTask"("jobId", "status");

-- CreateIndex
CREATE INDEX "RepairTask_assignedMechanicId_status_idx" ON "RepairTask"("assignedMechanicId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RepairEstimate_estimateNumber_key" ON "RepairEstimate"("estimateNumber");

-- CreateIndex
CREATE INDEX "RepairEstimate_jobId_idx" ON "RepairEstimate"("jobId");

-- CreateIndex
CREATE INDEX "CustomerApproval_estimateId_idx" ON "CustomerApproval"("estimateId");

-- CreateIndex
CREATE UNIQUE INDEX "SparePartRequest_requestNumber_key" ON "SparePartRequest"("requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SparePartRequest_estimateLineId_key" ON "SparePartRequest"("estimateLineId");

-- CreateIndex
CREATE INDEX "SparePartRequest_branchId_status_idx" ON "SparePartRequest"("branchId", "status");

-- CreateIndex
CREATE INDEX "SparePartRequest_jobId_idx" ON "SparePartRequest"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "SparePartIssue_requestId_key" ON "SparePartIssue"("requestId");

-- CreateIndex
CREATE INDEX "MechanicWorkLog_taskId_createdAt_idx" ON "MechanicWorkLog"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "MechanicWorkLog_mechanicId_createdAt_idx" ON "MechanicWorkLog"("mechanicId", "createdAt");

-- CreateIndex
CREATE INDEX "QualityInspection_jobId_idx" ON "QualityInspection"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceHandover_jobId_key" ON "ServiceHandover"("jobId");

-- CreateIndex
CREATE INDEX "ServiceTimelineEvent_jobId_occurredAt_idx" ON "ServiceTimelineEvent"("jobId", "occurredAt");

-- CreateIndex
CREATE INDEX "InternalActivityLog_branchId_createdAt_idx" ON "InternalActivityLog"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "InternalActivityLog_jobId_createdAt_idx" ON "InternalActivityLog"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "RepairDurationStandard_businessUnitId_taskKey_idx" ON "RepairDurationStandard"("businessUnitId", "taskKey");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_branchId_status_idx" ON "Invoice"("branchId", "status");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_serviceJobId_idx" ON "Invoice"("serviceJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- CreateIndex
CREATE INDEX "Payment_branchId_createdAt_idx" ON "Payment"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNumber_key" ON "CreditNote"("creditNoteNumber");

-- CreateIndex
CREATE INDEX "Expense_branchId_incurredOn_idx" ON "Expense"("branchId", "incurredOn");

-- CreateIndex
CREATE UNIQUE INDEX "WarrantyClaim_claimNumber_key" ON "WarrantyClaim"("claimNumber");

-- CreateIndex
CREATE INDEX "WarrantyClaim_branchId_status_idx" ON "WarrantyClaim"("branchId", "status");

-- CreateIndex
CREATE INDEX "WarrantyClaim_businessUnitId_status_idx" ON "WarrantyClaim"("businessUnitId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_key_channel_businessUnitId_key" ON "NotificationTemplate"("key", "channel", "businessUnitId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "FollowUp_branchId_status_dueAt_idx" ON "FollowUp"("branchId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFeedback_serviceJobId_key" ON "CustomerFeedback"("serviceJobId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_branchId_createdAt_idx" ON "AuditLog"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSetting_businessUnitId_key_key" ON "BusinessSetting"("businessUnitId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSetting_branchId_key_key" ON "BranchSetting"("branchId", "key");

-- AddForeignKey
ALTER TABLE "BusinessUnit" ADD CONSTRAINT "BusinessUnit_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BusinessGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranchAssignment" ADD CONSTRAINT "UserBranchAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranchAssignment" ADD CONSTRAINT "UserBranchAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBusinessUnitAssignment" ADD CONSTRAINT "UserBusinessUnitAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBusinessUnitAssignment" ADD CONSTRAINT "UserBusinessUnitAssignment_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_reportingManagerId_fkey" FOREIGN KEY ("reportingManagerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTarget" ADD CONSTRAINT "EmployeeTarget_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTarget" ADD CONSTRAINT "EmployeeTarget_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdAtBranchId_fkey" FOREIGN KEY ("createdAtBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerConsent" ADD CONSTRAINT "CustomerConsent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleModel" ADD CONSTRAINT "VehicleModel_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "VehicleModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerVehicle" ADD CONSTRAINT "CustomerVehicle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerVehicle" ADD CONSTRAINT "CustomerVehicle_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "VehicleModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerVehicle" ADD CONSTRAINT "CustomerVehicle_soldVehicleId_fkey" FOREIGN KEY ("soldVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_interestedModelId_fkey" FOREIGN KEY ("interestedModelId") REFERENCES "VehicleModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowroomTestRide" ADD CONSTRAINT "ShowroomTestRide_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowroomTestRide" ADD CONSTRAINT "ShowroomTestRide_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowroomTestRide" ADD CONSTRAINT "ShowroomTestRide_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "VehicleModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuotation" ADD CONSTRAINT "SalesQuotation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuotation" ADD CONSTRAINT "SalesQuotation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuotation" ADD CONSTRAINT "SalesQuotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuotation" ADD CONSTRAINT "SalesQuotation_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "VehicleModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBooking" ADD CONSTRAINT "VehicleBooking_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBooking" ADD CONSTRAINT "VehicleBooking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBooking" ADD CONSTRAINT "VehicleBooking_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "VehicleModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBooking" ADD CONSTRAINT "VehicleBooking_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBooking" ADD CONSTRAINT "VehicleBooking_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "SalesQuotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBooking" ADD CONSTRAINT "VehicleBooking_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_sparePartRequestId_fkey" FOREIGN KEY ("sparePartRequestId") REFERENCES "SparePartRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAudit" ADD CONSTRAINT "StockAudit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAudit" ADD CONSTRAINT "StockAudit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAuditLine" ADD CONSTRAINT "StockAuditLine_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "StockAudit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAuditLine" ADD CONSTRAINT "StockAuditLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_customerVehicleId_fkey" FOREIGN KEY ("customerVehicleId") REFERENCES "CustomerVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_serviceAdvisorId_fkey" FOREIGN KEY ("serviceAdvisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJobAssignment" ADD CONSTRAINT "ServiceJobAssignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJobAssignment" ADD CONSTRAINT "ServiceJobAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionChecklistTemplate" ADD CONSTRAINT "InspectionChecklistTemplate_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceInspection" ADD CONSTRAINT "ServiceInspection_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceInspection" ADD CONSTRAINT "ServiceInspection_examinerId_fkey" FOREIGN KEY ("examinerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_assignedMechanicId_fkey" FOREIGN KEY ("assignedMechanicId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairTaskDependency" ADD CONSTRAINT "RepairTaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "RepairTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairTaskDependency" ADD CONSTRAINT "RepairTaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "RepairTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairEstimate" ADD CONSTRAINT "RepairEstimate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "RepairEstimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApproval" ADD CONSTRAINT "CustomerApproval_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "RepairEstimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApproval" ADD CONSTRAINT "CustomerApproval_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "EstimateLineItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartRequest" ADD CONSTRAINT "SparePartRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartRequest" ADD CONSTRAINT "SparePartRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartRequest" ADD CONSTRAINT "SparePartRequest_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartRequest" ADD CONSTRAINT "SparePartRequest_estimateLineId_fkey" FOREIGN KEY ("estimateLineId") REFERENCES "EstimateLineItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartRequest" ADD CONSTRAINT "SparePartRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartRequest" ADD CONSTRAINT "SparePartRequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartRequest" ADD CONSTRAINT "SparePartRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartRequest" ADD CONSTRAINT "SparePartRequest_assignedMechanicId_fkey" FOREIGN KEY ("assignedMechanicId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartRequest" ADD CONSTRAINT "SparePartRequest_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartRequest" ADD CONSTRAINT "SparePartRequest_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartIssue" ADD CONSTRAINT "SparePartIssue_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SparePartRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartIssue" ADD CONSTRAINT "SparePartIssue_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartIssue" ADD CONSTRAINT "SparePartIssue_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparePartIssue" ADD CONSTRAINT "SparePartIssue_receivedByMechanicId_fkey" FOREIGN KEY ("receivedByMechanicId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MechanicWorkLog" ADD CONSTRAINT "MechanicWorkLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "RepairTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MechanicWorkLog" ADD CONSTRAINT "MechanicWorkLog_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRide" ADD CONSTRAINT "TestRide_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRide" ADD CONSTRAINT "TestRide_qualityInspectionId_fkey" FOREIGN KEY ("qualityInspectionId") REFERENCES "QualityInspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRide" ADD CONSTRAINT "TestRide_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceHandover" ADD CONSTRAINT "ServiceHandover_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePhoto" ADD CONSTRAINT "ServicePhoto_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePhoto" ADD CONSTRAINT "ServicePhoto_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTimelineEvent" ADD CONSTRAINT "ServiceTimelineEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalActivityLog" ADD CONSTRAINT "InternalActivityLog_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalActivityLog" ADD CONSTRAINT "InternalActivityLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairDurationStandard" ADD CONSTRAINT "RepairDurationStandard_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairDurationStandard" ADD CONSTRAINT "RepairDurationStandard_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairDurationStandard" ADD CONSTRAINT "RepairDurationStandard_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "VehicleModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "VehicleBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "VehicleBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_customerVehicleId_fkey" FOREIGN KEY ("customerVehicleId") REFERENCES "CustomerVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_sparePartIssueId_fkey" FOREIGN KEY ("sparePartIssueId") REFERENCES "SparePartIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "Warranty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaimDocument" ADD CONSTRAINT "WarrantyClaimDocument_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "WarrantyClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaimDocument" ADD CONSTRAINT "WarrantyClaimDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSetting" ADD CONSTRAINT "BusinessSetting_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchSetting" ADD CONSTRAINT "BranchSetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════
-- Hand-written integrity rules (Prisma cannot express these declaratively).
-- See docs/DATABASE.md.
-- ════════════════════════════════════════════════════════════════════════

-- Inventory can never go negative and reservations can never exceed stock on hand.
ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "InventoryBalance_onhand_nonneg" CHECK ("quantityOnHand" >= 0),
  ADD CONSTRAINT "InventoryBalance_reserved_nonneg" CHECK ("quantityReserved" >= 0),
  ADD CONSTRAINT "InventoryBalance_reserved_le_onhand" CHECK ("quantityReserved" <= "quantityOnHand"),
  ADD CONSTRAINT "InventoryBalance_min_nonneg" CHECK ("minStockLevel" >= 0);

ALTER TABLE "SparePartRequest" ADD CONSTRAINT "SparePartRequest_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "SparePartIssue" ADD CONSTRAINT "SparePartIssue_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_qty_pos" CHECK ("quantity" > 0 AND "receivedQuantity" >= 0);
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_qty_pos" CHECK ("quantity" > 0);

-- Money sanity.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts_nonneg" CHECK ("grandTotal" >= 0 AND "amountPaid" >= 0 AND "balanceDue" >= 0);
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_duration_order" CHECK ("estimatedMinMinutes" >= 0 AND "estimatedMaxMinutes" >= "estimatedMinMinutes");
ALTER TABLE "RepairDurationStandard" ADD CONSTRAINT "RepairDurationStandard_order" CHECK ("minMinutes" >= 0 AND "maxMinutes" >= "minMinutes");
ALTER TABLE "RepairTaskDependency" ADD CONSTRAINT "RepairTaskDependency_no_self" CHECK ("taskId" <> "dependsOnTaskId");

-- At most one ACTIVE reservation per spare-part request is already guaranteed by the unique FK;
-- a vehicle can be attached to at most one live booking.
CREATE UNIQUE INDEX "VehicleBooking_one_live_per_vehicle"
  ON "VehicleBooking" ("vehicleId") WHERE "vehicleId" IS NOT NULL AND "status" <> 'CANCELLED';

-- Only one invoice in a non-cancelled state per service job.
CREATE UNIQUE INDEX "Invoice_one_live_per_job"
  ON "Invoice" ("serviceJobId") WHERE "serviceJobId" IS NOT NULL AND "status" <> 'CANCELLED';

-- Stock ledger, audit log, approvals and timeline are append-only.
CREATE OR REPLACE FUNCTION oxina_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION oxina_block_mutation();
CREATE TRIGGER "StockMovement_append_only" BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION oxina_block_mutation();
CREATE TRIGGER "CustomerApproval_append_only" BEFORE UPDATE OR DELETE ON "CustomerApproval"
  FOR EACH ROW EXECUTE FUNCTION oxina_block_mutation();
CREATE TRIGGER "ServiceTimelineEvent_append_only" BEFORE UPDATE OR DELETE ON "ServiceTimelineEvent"
  FOR EACH ROW EXECUTE FUNCTION oxina_block_mutation();
CREATE TRIGGER "CreditNote_append_only" BEFORE UPDATE OR DELETE ON "CreditNote"
  FOR EACH ROW EXECUTE FUNCTION oxina_block_mutation();

-- Finalized invoices: monetary fields are frozen. Only payment progress
-- (amountPaid, creditedAmount, balanceDue, status) and cancellation may change.
CREATE OR REPLACE FUNCTION oxina_protect_finalized_invoice() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Finalized invoice % cannot be deleted', OLD."invoiceNumber" USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
       NEW."subtotal" IS DISTINCT FROM OLD."subtotal" OR
       NEW."discountTotal" IS DISTINCT FROM OLD."discountTotal" OR
       NEW."taxTotal" IS DISTINCT FROM OLD."taxTotal" OR
       NEW."cgstTotal" IS DISTINCT FROM OLD."cgstTotal" OR
       NEW."sgstTotal" IS DISTINCT FROM OLD."sgstTotal" OR
       NEW."igstTotal" IS DISTINCT FROM OLD."igstTotal" OR
       NEW."grandTotal" IS DISTINCT FROM OLD."grandTotal" OR
       NEW."customerId" IS DISTINCT FROM OLD."customerId" OR
       NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber" OR
       NEW."finalizedAt" IS DISTINCT FROM OLD."finalizedAt") THEN
    RAISE EXCEPTION 'Finalized invoice % is immutable; use a credit note or cancellation', OLD."invoiceNumber" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'CANCELLED' AND NEW."status" <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Cancelled invoice cannot be reopened' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Invoice_protect_finalized" BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION oxina_protect_finalized_invoice();

CREATE OR REPLACE FUNCTION oxina_protect_finalized_invoice_lines() RETURNS trigger AS $$
DECLARE inv_status text;
BEGIN
  SELECT "status" INTO inv_status FROM "Invoice"
   WHERE "id" = COALESCE(NEW."invoiceId", OLD."invoiceId");
  IF inv_status IS NOT NULL AND inv_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Lines of a finalized invoice cannot be changed' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceLineItem_protect_finalized" BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLineItem"
  FOR EACH ROW EXECUTE FUNCTION oxina_protect_finalized_invoice_lines();
