const path = require("path");
const express = require("express");
const app = express();
const viewRouter = require("./routes/viewRoutes");

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/", viewRouter);
app.use("/profile", viewRouter);

module.exports = app;
