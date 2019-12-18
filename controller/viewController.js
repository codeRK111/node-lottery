exports.getBase = (req, res) => {
    res.status(200).render("base", {
        window: {
            target_date: new Date().getTime() + 1000 * 3600 * 96
        }
    });
};
exports.getProfile = (req, res) => {
    res.status(200).render("profile", {
        window: {
            target_date: new Date().getTime() + 1000 * 3600 * 96
        }
    });
};
