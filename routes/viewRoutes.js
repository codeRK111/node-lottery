const express = require("express");
const router = express.Router();
const viewController = require("../controller/viewController");

router.get("/", viewController.getBase);
router.get("/profile", viewController.getProfile);

module.exports = router;
