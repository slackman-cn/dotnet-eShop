-- 与 eShop AppHost 中 postgres.AddDatabase(...) 的四个库名对齐：
-- catalogdb、identitydb、orderingdb、webhooksdb
-- 仅在数据卷首次初始化时执行。
CREATE DATABASE catalogdb;
CREATE DATABASE identitydb;
CREATE DATABASE orderingdb;
CREATE DATABASE webhooksdb;
